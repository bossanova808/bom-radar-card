/**
 * Replace the card-owned shadow DOM without removing card-mod's injected
 * element. Keeping that element connected preserves host styles across a
 * Home Assistant view detach/reconnect cycle.
 */
export function replaceShadowContentPreservingCardMod(shadowRoot, html) {
  const preservedNodes = new Set(
    Array.from(shadowRoot.childNodes).filter((node) => node?.localName === 'card-mod'),
  );

  for (const node of Array.from(shadowRoot.childNodes)) {
    if (!preservedNodes.has(node)) node.remove();
  }

  const template = shadowRoot.ownerDocument.createElement('template');
  template.innerHTML = html;
  shadowRoot.insertBefore(template.content, shadowRoot.firstChild);
}
