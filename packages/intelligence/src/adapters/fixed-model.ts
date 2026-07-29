/** A deterministic model boundary for fixtures and tests. */
export class ModelProviderError extends Error {
  constructor(readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR") {
    super(code);
  }
}

/**
 * This adapter returns raw scripted output. Intelligence modules must validate
 * that output before they use it for policy, rendering, or proposals.
 */
export class FixedModelAdapter {
  readonly requests: { requestId: string }[] = [];

  constructor(private readonly outputs: ReadonlyMap<string, unknown | Error>) {}

  async generate(input: { requestId: string }): Promise<unknown> {
    this.requests.push(input);
    const output = this.outputs.get(input.requestId);
    if (output instanceof Error) {
      throw output;
    }
    return output;
  }
}
