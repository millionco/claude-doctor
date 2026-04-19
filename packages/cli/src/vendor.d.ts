declare module "sentiment" {
  interface SentimentResult {
    score: number;
    comparative: number;
    positive: string[];
    negative: string[];
    tokens: string[];
    words: string[];
  }

  interface SentimentOptions {
    extras?: Record<string, number>;
    language?: string;
  }

  class Sentiment {
    analyze(phrase: string, options?: SentimentOptions): SentimentResult;
    registerLanguage(language: string, module: { labels: Record<string, number> }): void;
  }

  export default Sentiment;
}
