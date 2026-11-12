export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export const modelPresets = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' },
  custom: { baseUrl: '', model: '' },
};
export function chatEndpoint(base: string): string {
  const url = new URL(base.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw Error('模型地址请使用 HTTPS，本机服务可使用 HTTP');
  if (url.username || url.password || url.search || url.hash)
    throw Error('模型地址请填写纯接口地址，API Key 填在独立输入框');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}
export async function complete(
  config: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<string> {
  if (!config.model.trim()) throw Error('请在模型设置中填写模型名称');
  const endpoint = chatEndpoint(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey.trim() } : {}),
      },
      body: JSON.stringify({ model: config.model.trim(), messages, stream: false }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw Error(
      '连接失败，请检查模型地址、网络，以及服务的浏览器跨域访问（CORS）支持。可填写支持浏览器调用的兼容网关。',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = String(data?.error?.message || data?.message || response.statusText).replaceAll(
      config.apiKey || '\u0000',
      '[已隐藏]',
    );
    throw Error(`模型服务返回 ${response.status}，${detail.slice(0, 300)}`);
  }
  if (data?.choices?.[0]?.finish_reason === 'length')
    throw Error('模型返回内容被截断，请缩小选择范围后重试');
  const content = data?.choices?.[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part: { text?: string }) => part.text || '').join('')
        : '';
  if (!text.trim()) throw Error('模型未返回正文，请检查模型名称或关闭服务端的纯推理输出模式');
  return text;
}
export function readJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw Error('模型返回格式不完整，请重试或更换模型');
  }
}
