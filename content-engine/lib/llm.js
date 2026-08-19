// Every generative step goes through here so model choice, effort, and retries are
// configured in exactly one place.
//
// Two routes, same call site:
//   - Anthropic API directly (the default, and what GitHub Actions uses)
//   - a 9router gateway (LLM_BASE_URL), for local runs on station D where 9router
//     is already fronting the provider accounts on localhost:20128
//
// 9router speaks the Anthropic wire format on /v1, so pointing baseURL at it is the
// only change needed — the request bodies below are identical either way.

import Anthropic from '@anthropic-ai/sdk';
import { required, optional } from './env.js';
import { logger } from './log.js';

const log = logger('llm');

let client;
function getClient() {
  if (client) return client;
  const baseURL = optional('LLM_BASE_URL');
  client = new Anthropic({
    apiKey: required('ANTHROPIC_API_KEY'),
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 3,
  });
  if (baseURL) log.info('routing through gateway', { baseURL });
  return client;
}

export const MODEL = optional('LLM_MODEL', 'claude-opus-5');

/**
 * Ask Claude for JSON matching a schema, and get back a parsed object.
 * Structured outputs mean the pipeline never has to regex a model response.
 */
export async function generateJson({ system, prompt, schema, effort = 'high', maxTokens = 8000 }) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Model declined the request (${response.stop_details?.category ?? 'unknown'}): ` +
        `${response.stop_details?.explanation ?? 'no explanation'}`,
    );
  }

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new Error('Model returned no text content');

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Model output was not valid JSON: ${error.message}\n${text.slice(0, 500)}`);
  }
}

export async function generateText({ system, prompt, effort = 'medium', maxTokens = 4000 }) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined the request: ${response.stop_details?.explanation ?? ''}`);
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
