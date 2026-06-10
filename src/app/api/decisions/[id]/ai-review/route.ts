// src/app/api/decisions/[id]/ai-review/route.ts
//
// POST /api/decisions/:id/ai-review
//
// Triggers all AI agent stakeholders on a decision to cast their votes.
// Each agent gets the full decision context + existing human votes, then
// responds with a structured { stance, reasoning } via Claude API.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { checkAutoLock } from '@/lib/decisions/state-machine'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The structured output we expect Claude to return
type AgentVoteResponse = {
  stance: 'APPROVE' | 'BLOCK' | 'NEEDS_MORE_INFO' | 'ABSTAIN'
  reasoning: string
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const decision = await db.decision.findUnique({
    where: { id: params.id },
    include: {
      stakeholders: {
        include: {
          user: {
            include: { agentPersona: true },
          },
        },
      },
      votes: {
        include: { user: true },
      },
    },
  })

  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (decision.status !== 'OPEN') {
    return NextResponse.json({ error: 'Decision is not open' }, { status: 400 })
  }

  // Find AI stakeholders who haven't voted yet
  const votedUserIds = new Set(decision.votes.map(v => v.userId))
  const agentStakeholders = decision.stakeholders.filter(
    s => s.user.isAgent && s.user.agentPersona && !votedUserIds.has(s.userId)
  )

  if (agentStakeholders.length === 0) {
    return NextResponse.json({ message: 'No pending AI votes' })
  }

  // Build context about existing human votes to show agents
  const humanVotes = decision.votes.filter(v => !v.user.isAgent)
  const humanVoteContext =
    humanVotes.length > 0
      ? `\n\n**Other stakeholder votes so far:**\n${humanVotes
          .map(v => `- ${v.user.name}: ${v.stance} — "${v.reasoning}"`)
          .join('\n')}`
      : ''

  const results = []

  // Call Claude for each AI agent in parallel
  await Promise.all(
    agentStakeholders.map(async stakeholder => {
      const persona = stakeholder.user.agentPersona!

      const message = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: persona.systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Here is a decision proposal that requires your review:

**Title:** ${decision.title}

**Context:**
${decision.context}

${decision.options ? `**Options considered:**\n${decision.options}` : ''}
${humanVoteContext}

Respond ONLY with a JSON object in this exact format (no markdown, no explanation outside the JSON):
{
  "stance": "APPROVE" | "BLOCK" | "NEEDS_MORE_INFO" | "ABSTAIN",
  "reasoning": "Your detailed reasoning here (2-4 sentences from your role's perspective)"
}`,
          },
        ],
      })

      // Parse Claude's response
      const raw = message.content[0].type === 'text' ? message.content[0].text : ''
      let vote: AgentVoteResponse

      try {
        vote = JSON.parse(raw.trim()) as AgentVoteResponse
      } catch {
        // Fallback if Claude doesn't return clean JSON
        vote = {
          stance: 'NEEDS_MORE_INFO',
          reasoning: 'Unable to parse agent response. Please retry.',
        }
      }

      // Upsert the vote (handles re-runs gracefully)
      await db.vote.upsert({
        where: {
          decisionId_userId: {
            decisionId: decision.id,
            userId: stakeholder.userId,
          },
        },
        create: {
          decisionId: decision.id,
          userId: stakeholder.userId,
          stance: vote.stance,
          reasoning: vote.reasoning,
        },
        update: {
          stance: vote.stance,
          reasoning: vote.reasoning,
        },
      })

      // Log activity
      await db.activity.create({
        data: {
          decisionId: decision.id,
          actorId: stakeholder.userId,
          type: 'VOTE_CAST',
          payload: { stance: vote.stance, isAgent: true },
        },
      })

      results.push({
        agent: persona.name,
        stance: vote.stance,
        reasoning: vote.reasoning,
      })
    })
  )

  // After all AI votes are in, check if the decision should auto-lock
  await checkAutoLock(decision.id)

  return NextResponse.json({ votes: results })
}
