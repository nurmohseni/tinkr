/**
 * The providers a completion can be asked of.
 *
 * Everything but Anthropic speaks the OpenAI chat completions api, Ollama
 * included (on its /v1 endpoint), so there are two shapes of request and one
 * place that knows which is which.
 *
 * The endpoint is only a default: whatever the user sets as `ai_endpoint` wins,
 * and Custom has none to fall back on.
 */
const providers = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
  },
  'openai-codex': {
    label: 'OpenAI Codex',
    endpoint: 'https://api.openai.com/v1',
  },
  claude: {
    label: 'Claude',
    endpoint: 'https://api.anthropic.com',
    style: 'anthropic',
  },
  ollama: {
    label: 'Ollama',
    endpoint: 'http://localhost:11434/v1',
    needsToken: false,
  },
  'opencode-zen': {
    label: 'OpenCode Zen',
    endpoint: 'https://opencode.ai/zen/v1',
  },
  'opencode-go': {
    label: 'OpenCode Go',
    endpoint: 'https://opencode.ai/zen/go/v1',
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
  },
  custom: {
    label: 'Custom',
    endpoint: '',
  },
}

module.exports = {
  providers,
}
