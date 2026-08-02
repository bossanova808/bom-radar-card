import { test } from 'node:test';
import assert from 'node:assert/strict';

import { replaceShadowContentPreservingCardMod } from '../src/shadow-content.js';

function createNode(localName) {
  return { localName, removeCalls: 0 };
}

function createShadowRoot(nodes) {
  const childNodes = [...nodes];
  const inserted = [];
  let templateHtml = null;

  const root = {
    ownerDocument: {
      createElement(localName) {
        assert.equal(localName, 'template');
        const template = { content: { localName: '#document-fragment' } };
        Object.defineProperty(template, 'innerHTML', {
          set(value) {
            templateHtml = value;
          },
        });
        return template;
      },
    },
    get childNodes() {
      return childNodes;
    },
    get firstChild() {
      return childNodes[0] ?? null;
    },
    insertBefore(content, referenceNode) {
      inserted.push({ content, referenceNode });
    },
  };

  for (const node of nodes) {
    node.remove = () => {
      node.removeCalls += 1;
      const index = childNodes.indexOf(node);
      if (index !== -1) childNodes.splice(index, 1);
    };
  }

  return {
    root,
    inserted,
    get templateHtml() {
      return templateHtml;
    },
  };
}

test('replaces card-owned shadow content without disconnecting card-mod', () => {
  const oldStyle = createNode('style');
  const oldCard = createNode('ha-card');
  const cardMod = createNode('card-mod');
  const fixture = createShadowRoot([oldStyle, oldCard, cardMod]);

  replaceShadowContentPreservingCardMod(fixture.root, '<style>new</style><ha-card>new</ha-card>');

  assert.equal(oldStyle.removeCalls, 1);
  assert.equal(oldCard.removeCalls, 1);
  assert.equal(cardMod.removeCalls, 0);
  assert.deepEqual(fixture.root.childNodes, [cardMod]);
  assert.equal(fixture.templateHtml, '<style>new</style><ha-card>new</ha-card>');
  assert.equal(fixture.inserted.length, 1);
  assert.equal(fixture.inserted[0].referenceNode, cardMod);
});

test('replaces all existing content when card-mod is not installed', () => {
  const oldStyle = createNode('style');
  const oldCard = createNode('ha-card');
  const fixture = createShadowRoot([oldStyle, oldCard]);

  replaceShadowContentPreservingCardMod(fixture.root, '<ha-card>replacement</ha-card>');

  assert.equal(oldStyle.removeCalls, 1);
  assert.equal(oldCard.removeCalls, 1);
  assert.deepEqual(fixture.root.childNodes, []);
  assert.equal(fixture.inserted[0].referenceNode, null);
});
