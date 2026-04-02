/**
 * Request adapter: Anthropic message format → OpenAI chat completion format.
 *
 * Handles the three core request-side differences:
 * 1. system prompt: top-level `system` field → messages[0] role=system
 * 2. multimodal: image.source.base64 → image_url with data URI
 * 3. tools: input_schema → function.parameters; tool_result → role=tool
 *
 * FIX(2026-04-02): Anthropic API allows consecutive same-role messages,
 * but OpenAI format requires strict user/assistant alternation. Claude Code
 * splits a single assistant turn into multiple messages (thinking-only +
 * text + tool_use), which produces consecutive assistant messages that
 * break third-party OpenAI-compatible APIs. The postprocessMessages()
 * step merges them back into single messages.
 */

export interface OpenAICompatRequestConfig {
  model: string
  baseURL: string
  apiKey: string
}

export function transformRequest(
  anthropicParams: Record<string, any>,
  config: OpenAICompatRequestConfig,
): Record<string, any> {
  const messages = convertMessages(anthropicParams)
  const tools = convertTools(anthropicParams.tools)

  const result: Record<string, any> = {
    model: config.model,
    messages,
    stream: anthropicParams.stream ?? false,
    max_tokens: anthropicParams.max_tokens,
  }

  // Only set temperature when explicitly provided and not undefined
  if (anthropicParams.temperature !== undefined) {
    result.temperature = anthropicParams.temperature
  }

  if (tools.length > 0) {
    result.tools = tools
  }

  if (anthropicParams.tool_choice) {
    result.tool_choice = convertToolChoice(anthropicParams.tool_choice)
  }

  // Stream options: request usage in stream chunks if available
  if (anthropicParams.stream) {
    result.stream_options = { include_usage: true }
  }

  return result
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function convertMessages(params: Record<string, any>): any[] {
  const messages: any[] = []

  // Difference 1: Anthropic system is a top-level field; OpenAI uses role=system
  if (params.system) {
    const systemText = Array.isArray(params.system)
      ? params.system.map((b: any) => b.text ?? '').join('\n')
      : String(params.system)
    if (systemText) {
      messages.push({ role: 'system', content: systemText })
    }
  }

  for (const msg of params.messages ?? []) {
    if (msg.role === 'assistant') {
      messages.push(convertAssistantMessage(msg))
    } else if (msg.role === 'user') {
      // User messages may expand into multiple messages (tool_result splits)
      const converted = convertUserMessage(msg)
      if (Array.isArray(converted)) {
        messages.push(...converted)
      } else {
        messages.push(converted)
      }
    }
  }

  // FIX: Postprocess to ensure OpenAI-compatible message sequence
  return postprocessMessages(messages)
}

// ---------------------------------------------------------------------------
// FIX: Postprocess — merge consecutive same-role & drop empty messages
// ---------------------------------------------------------------------------

/**
 * OpenAI chat completion API requires strict role alternation:
 *   system? → user → assistant → user → assistant → ...
 *
 * Anthropic API allows consecutive same-role messages. Claude Code exploits
 * this heavily — a single assistant "turn" may be split across 2-4 messages:
 *   assistant: [thinking only]     ← content becomes "" after conversion
 *   assistant: [text]              ← actual reply
 *   assistant: [tool_use]          ← tool calls
 *
 * Third-party APIs (MiniMax, GLM, Qwen, DeepSeek via gateways) handle this
 * violation unpredictably: some silently drop earlier messages, some truncate
 * history, some error out. This function normalizes the sequence.
 */
function postprocessMessages(messages: any[]): any[] {
  const result: any[] = []

  for (const msg of messages) {
    // Skip completely empty assistant messages (thinking-only after conversion)
    if (
      msg.role === 'assistant' &&
      !msg.content &&
      (!msg.tool_calls || msg.tool_calls.length === 0)
    ) {
      continue
    }

    const prev = result[result.length - 1]

    // Merge consecutive assistant messages
    if (prev && prev.role === 'assistant' && msg.role === 'assistant') {
      // Merge text content
      const prevText = prev.content || ''
      const curText = msg.content || ''
      if (curText) {
        prev.content = prevText ? prevText + '\n' + curText : curText
      }
      // Merge tool_calls arrays
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        if (!prev.tool_calls) {
          prev.tool_calls = []
        }
        prev.tool_calls.push(...msg.tool_calls)
      }
      continue
    }

    // Merge consecutive user messages (can happen after tool_result expansion)
    if (prev && prev.role === 'user' && msg.role === 'user') {
      const prevText =
        typeof prev.content === 'string'
          ? prev.content
          : Array.isArray(prev.content)
            ? prev.content
                .map((b: any) => (b.type === 'text' ? b.text : ''))
                .join('')
            : ''
      const curText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((b: any) => (b.type === 'text' ? b.text : ''))
                .join('')
            : ''
      if (curText) {
        prev.content = prevText ? prevText + '\n' + curText : curText
      }
      continue
    }

    // Normal case: different role, just push
    result.push({ ...msg })
  }

  return result
}

// ---------------------------------------------------------------------------
// Assistant message conversion
// ---------------------------------------------------------------------------

function convertAssistantMessage(msg: Record<string, any>): Record<string, any> {
  const content = msg.content
  if (typeof content === 'string') {
    return { role: 'assistant', content }
  }
  if (!Array.isArray(content)) {
    return { role: 'assistant', content: '' }
  }

  let textContent = ''
  const toolCalls: any[] = []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        textContent += block.text ?? ''
        break
      case 'thinking':
        // Some models echo thinking back — ignore it in history to avoid
        // confusing models that don't support it.
        break
      case 'tool_use':
        // Difference 2: Anthropic tool input is an object; OpenAI arguments is a JSON string
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        })
        break
      // Skip server_tool_use, tool_reference, advisor_tool_result etc.
      default:
        break
    }
  }

  const result: Record<string, any> = { role: 'assistant' }
  if (textContent) result.content = textContent
  if (toolCalls.length > 0) result.tool_calls = toolCalls
  // OpenAI requires at least one of content or tool_calls
  if (!textContent && toolCalls.length === 0) result.content = ''
  return result
}

// ---------------------------------------------------------------------------
// User message conversion
// ---------------------------------------------------------------------------

function convertUserMessage(msg: Record<string, any>): any {
  const content = msg.content
  if (typeof content === 'string') {
    return { role: 'user', content }
  }
  if (!Array.isArray(content)) {
    return { role: 'user', content: '' }
  }

  // Separate tool_results (become independent role=tool messages) from other content
  const userParts: any[] = []
  const toolResults: any[] = []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        userParts.push({ type: 'text', text: block.text ?? '' })
        break
      case 'image': {
        // Difference 1: Anthropic base64 → OpenAI image_url data URI
        const src = block.source
        if (src?.type === 'base64' && src.data) {
          userParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type || 'image/png'};base64,${src.data}`,
            },
          })
        }
        break
      }
      case 'tool_result': {
        // Difference 2: Anthropic wraps tool_result inside user message;
        // OpenAI uses independent role=tool messages
        let resultContent: string
        if (typeof block.content === 'string') {
          resultContent = block.content
        } else if (Array.isArray(block.content)) {
          resultContent = block.content
            .map((b: any) => {
              if (b.type === 'text') return b.text ?? ''
              if (b.type === 'image') return '[image]'
              return ''
            })
            .join('')
        } else {
          resultContent = block.is_error ? 'Error' : 'OK'
        }
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: resultContent || (block.is_error ? 'Error' : 'OK'),
        })
        break
      }
      case 'document':
        // PDFs etc. — fall back to text representation
        userParts.push({
          type: 'text',
          text: '[document attached]',
        })
        break
      // cache_control, tool_reference etc. are Anthropic-specific → skip
      default:
        break
    }
  }

  const result: any[] = []

  // Tool results come first (OpenAI requires them immediately after the
  // assistant message that initiated the tool calls)
  result.push(...toolResults)

  // Then user content
  if (userParts.length > 0) {
    if (userParts.length === 1 && userParts[0].type === 'text') {
      result.push({ role: 'user', content: userParts[0].text })
    } else {
      result.push({ role: 'user', content: userParts })
    }
  }

  // If only tool results, return them as array
  if (result.length === 0) {
    return { role: 'user', content: '' }
  }
  if (result.length === 1) {
    return result[0]
  }
  return result
}

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

function convertTools(anthropicTools?: any[]): any[] {
  if (!anthropicTools || anthropicTools.length === 0) return []

  return anthropicTools
    .filter((t: any) => {
      // Skip Anthropic-specific tool types that OpenAI doesn't understand
      if (t.type === 'server_tool_use') return false
      if (t.type === 'advisor_20260301') return false
      if (t.defer_loading) return false
      return true
    })
    .map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        // Difference 1: Anthropic uses input_schema; OpenAI uses parameters
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }))
}

function convertToolChoice(
  anthropicChoice: Record<string, any>,
): any {
  if (!anthropicChoice) return undefined
  switch (anthropicChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'tool':
      return {
        type: 'function',
        function: { name: anthropicChoice.name },
      }
    default:
      return 'auto'
  }
}