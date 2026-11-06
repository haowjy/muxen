/** A key that belongs to an IME: Return confirming a candidate is not the app's. Safari reports it after `compositionend`, as keyCode 229 with isComposing already false. */
export function imeKey(e: { isComposing: boolean; keyCode: number }): boolean {
  return e.isComposing || e.keyCode === 229;
}
