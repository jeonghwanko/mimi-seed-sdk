import type Anthropic from "@anthropic-ai/sdk";
import { isMissingAnthropicSdk } from "#core/ai.js";

/** `@anthropic-ai/sdk` 를 쓸 때만 로드한다. `mimi-seed --version` / `check` 경로에서는 부르지 말 것. */
export async function loadAnthropic(apiKey: string): Promise<Anthropic> {
  let AnthropicSdk: typeof import("@anthropic-ai/sdk").default;
  try {
    ({ default: AnthropicSdk } = await import("@anthropic-ai/sdk"));
  } catch (error) {
    if (isMissingAnthropicSdk(error)) {
      throw new Error(
        "@anthropic-ai/sdk is not installed. Reinstall mimi-seed with --include=optional in the same npm project or global prefix.",
        { cause: error },
      );
    }
    throw error;
  }
  return new AnthropicSdk({ apiKey });
}
