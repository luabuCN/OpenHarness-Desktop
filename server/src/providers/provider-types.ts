/**
 * Curated catalog of well-known provider types shown in the "type" selector.
 * Mirrors aime-chat's models.json driven type list (id + display name) but
 * trimmed to the providers whose logos ship in web/public/model-logos, plus
 * the default OpenAI-compatible base URL used to prefill the form.
 */
export interface ProviderType {
  id: string;
  name: string;
  api?: string;
}

export const PROVIDER_TYPES: ProviderType[] = [
  { id: "openai", name: "OpenAI", api: "https://api.openai.com/v1" },
  { id: "openai-responses", name: "OpenAI Responses API", api: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", api: "https://api.anthropic.com/v1" },
  { id: "deepseek", name: "DeepSeek", api: "https://api.deepseek.com" },
  { id: "zhipuai", name: "Zhipu AI", api: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "tongyi", name: "Tongyi (DashScope)", api: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "google", name: "Google", api: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "groq", name: "Groq", api: "https://api.groq.com/openai/v1" },
  { id: "openrouter", name: "OpenRouter", api: "https://openrouter.ai/api/v1" },
  { id: "siliconflow", name: "SiliconFlow", api: "https://api.siliconflow.com/v1" },
  { id: "moonshot", name: "Moonshot", api: "https://api.moonshot.cn/v1" },
  { id: "minimax", name: "MiniMax", api: "https://api.minimax.io/v1" },
  { id: "mistral", name: "Mistral", api: "https://api.mistral.ai/v1" },
  { id: "xai", name: "xAI", api: "https://api.x.ai/v1" },
  { id: "togetherai", name: "Together AI", api: "https://api.together.xyz/v1" },
  { id: "fireworks-ai", name: "Fireworks AI", api: "https://api.fireworks.ai/inference/v1" },
  { id: "cerebras", name: "Cerebras", api: "https://api.cerebras.ai/v1" },
  { id: "huggingface", name: "Hugging Face", api: "https://router.huggingface.co/v1" },
  { id: "modelscope", name: "ModelScope", api: "https://api-inference.modelscope.cn/v1" },
  { id: "volcanoengine", name: "Volcano Engine", api: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "baidu", name: "Baidu Qianfan", api: "https://qianfan.baidubce.com/v2" },
  { id: "azure_openai", name: "Azure OpenAI" },
  { id: "ollama", name: "Ollama", api: "http://localhost:11434/v1" },
  { id: "lmstudio", name: "LM Studio", api: "http://127.0.0.1:1234/v1" },
  { id: "openai-compatible", name: "OpenAI Compatible (custom)" },
];

export function findProviderType(id: string): ProviderType | undefined {
  return PROVIDER_TYPES.find((type) => type.id === id);
}
