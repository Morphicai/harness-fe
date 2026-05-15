# Proposal: Add rrweb Recordings

## Why

Current Harnessa-FE observability is strong for logs, errors, network history, and command traces, but weak for reconstructing what actually happened in the UI before and during a failure. Agents can see symptoms without seeing the browser state transitions that produced them.

rrweb fills that gap. It gives the system a browser-native recording layer that can be aligned with the existing timeline so an agent can move from:

1. an error or suspicious network event,
2. to the relevant time window,
3. to the exact UI playback or raw recording events for that window.

## What Changes

This change adds a first-class rrweb recording pipeline to Harnessa-FE:

- the runtime client records browser activity with rrweb
- recordings are chunked and streamed to the MCP server
- the MCP server stores recording payloads separately from normal timeline events
- the timeline stores lightweight recording coverage metadata and markers
- agents gain bounded tools for listing coverage, querying around a timestamp, and retrieving replayable slices
- overlapping coverage is "melted" into merged intervals for easier agent navigation
- retention for recordings becomes configurable so storage growth stays bounded

## Goals

- Make browser recordings available as a durable debugging artifact in development sessions
- Keep ordinary timeline queries fast by separating heavy rrweb payloads from timeline storage
- Let agents find recordings through timeline metadata instead of reading whole recording files
- Merge adjacent or overlapping coverage into interval views so agents do not have to reason about fragmented chunks
- Support configurable retention so recording growth stays manageable

## Non-Goals

- Production analytics or end-user monitoring
- Privacy redaction beyond what is minimally needed for development use
- A full hosted replay service
- Automatic natural-language summarization of recordings in the initial slice

## Initial Delivery Shape

The first implementation slice should prioritize a minimal closed loop:

1. runtime client records rrweb events
2. bridge routes rrweb chunks into recording storage
3. timeline stores recording chunk metadata and markers
4. agent can list recording coverage and request a bounded recording slice by time range

Replay viewers, keyframe extraction, and richer summarization can follow after the core protocol is proven.
