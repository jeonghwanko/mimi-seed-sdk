import type Anthropic from "@anthropic-ai/sdk";

function isMissingAnthropicSdk(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const haystack = [err.code, err.message, err.cause?.code, err.cause?.message]
    .filter(Boolean)
    .join(" ");
  return haystack.includes("ERR_MODULE_NOT_FOUND") && haystack.includes("@anthropic-ai/sdk");
}

/** `@anthropic-ai/sdk` 를 쓸 때만 로드한다. `mimi-seed --version` / `check` 경로에서는 부르지 말 것. */
export async function loadAnthropic(apiKey: string): Promise<Anthropic> {
  let AnthropicSdk: typeof import("@anthropic-ai/sdk").default;
  try {
    ({ default: AnthropicSdk } = await import("@anthropic-ai/sdk"));
  } catch (error) {
    if (isMissingAnthropicSdk(error)) {
      throw new Error(
        "@anthropic-ai/sdk is not installed. Install it to use AI release notes and review replies: npm install @anthropic-ai/sdk",
        { cause: error },
      );
    }
    throw error;
  }
  return new AnthropicSdk({ apiKey });
}
