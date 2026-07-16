import { DomainClass } from "../../domain/domain-class.ts";

export class ReviewClipboardCopyClass extends DomainClass<
  {},
  { writeText: (text: string) => Promise<void> }
> {
  public async copy(params: {
    text: string;
    onStart: () => void;
    onFinish: () => void;
  }): Promise<boolean> {
    params.onStart();
    try {
      await this.deps.writeText(params.text);
      return true;
    } catch {
      return false;
    } finally {
      params.onFinish();
    }
  }
}
