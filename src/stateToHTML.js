/* @flow */

import {Entity} from 'draft-js';
import {
  getEntityRanges,
  BLOCK_TYPE, ENTITY_TYPE, INLINE_STYLE,
} from 'draft-js-utils';

import type {ContentState, ContentBlock, EntityInstance} from 'draft-js';
import type {CharacterMetaList} from 'draft-js-utils';

type StringMap = {[key: string]: ?string};
type BoolMap = {[key: string]: ?boolean};

const {
  BOLD,
  CODE,
  ITALIC,
  STRIKETHROUGH,
  UNDERLINE,
} = INLINE_STYLE;

const INDENT = '  ';
const BREAK = '<br/>';

// Map entity data to element attributes.
const ENTITY_ATTR_MAP = {
  [ENTITY_TYPE.LINK]: {url: 'href', rel: 'rel', target: 'target', title: 'title'},
  [ENTITY_TYPE.IMAGE]: {src: 'src', alt: 'alt', 'data-original-url': 'href'},
};

const COLOR_STYLE_MAP = {
  TEXT_DEFAULT: { color: '#878787' },
  TEXT_WHITE: { color: '#fff' },
  TEXT_BLACK: { color: '#000' },
  TEXT_RED: { color: 'rgb(255, 0, 0)' },
  TEXT_ORANGE: { color: 'rgb(255, 127, 0)' },
  TEXT_YELLOW: { color: 'rgb(180, 180, 0)' },
  TEXT_GREEN: { color: 'rgb(0, 180, 0)' },
  TEXT_BLUE: { color: 'rgb(0, 0, 255)' },
  TEXT_INDIGO: { color: 'rgb(75, 0, 130)' },
  TEXT_VIOLET: { color: 'rgb(127, 0, 255)' },
  BACKGROUND_DEFAULT: { backgroundColor: '#fff' },
  BACKGROUND_BLACK: { backgroundColor: '#000' },
  BACKGROUND_RED: { backgroundColor: 'rgb(255, 0, 0)' },
  BACKGROUND_ORANGE: { backgroundColor: 'rgb(255, 127, 0)' },
  BACKGROUND_YELLOW: { backgroundColor: 'rgb(180, 180, 0)' },
  BACKGROUND_GREEN: { backgroundColor: 'rgb(0, 180, 0)' },
  BACKGROUND_BLUE: { backgroundColor: 'rgb(0, 0, 255)' },
  BACKGROUND_INDIGO: { backgroundColor: 'rgb(75, 0, 130)' },
  BACKGROUND_VIOLET: { backgroundColor: 'rgb(127, 0, 255)' }
};

const dataToAttr = (entityType: string, entity: EntityInstance): StringMap => {
  let attrMap = ENTITY_ATTR_MAP.hasOwnProperty(entityType) ? ENTITY_ATTR_MAP[entityType] : {};
  let data = entity.getData();
  let attrs = {};
  for (let dataKey of Object.keys(data)) {
    let dataValue = data[dataKey];
    if (attrMap.hasOwnProperty(dataKey)) {
      let attrKey = attrMap[dataKey];
      attrs[attrKey] = dataValue;
    }
  }
  return attrs;
};

const decamelize = (str, sep) => {
  if (typeof str !== 'string') {
    throw new TypeError('Expected a string');
  }
  sep = typeof sep === 'undefined' ? '_' : sep;
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1' + sep + '$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1' + sep + '$2')
    .toLowerCase();
};

// The reason this returns an array is because a single block might get wrapped
// in two tags.
function getTags(blockType: string): Array<string> {
  switch (blockType) {
    case BLOCK_TYPE.HEADER_ONE:
      return ['h1'];
    case BLOCK_TYPE.HEADER_TWO:
      return ['h2'];
    case BLOCK_TYPE.HEADER_THREE:
      return ['h3'];
    case BLOCK_TYPE.HEADER_FOUR:
      return ['h4'];
    case BLOCK_TYPE.HEADER_FIVE:
      return ['h5'];
    case BLOCK_TYPE.HEADER_SIX:
      return ['h6'];
    case BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case BLOCK_TYPE.ORDERED_LIST_ITEM:
    case BLOCK_TYPE.CHECKABLE_LIST_ITEM:
      return ['li'];
    case BLOCK_TYPE.BLOCKQUOTE:
      return ['blockquote'];
    case BLOCK_TYPE.CODE:
      return ['pre', 'code'];
    case BLOCK_TYPE.ATOMIC:
      return ['figure'];
    default:
      return ['div'];
  }
}

function getWrapperTag(blockType: string): ?string {
  switch (blockType) {
    case BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case BLOCK_TYPE.CHECKABLE_LIST_ITEM:
      return 'ul';
    case BLOCK_TYPE.ORDERED_LIST_ITEM:
      return 'ol';
    default:
      return null;
  }
}

class MarkupGenerator {
  blocks: Array<ContentBlock>;
  contentState: ContentState;
  currentBlock: number;
  indentLevel: number;
  output: Array<string>;
  totalBlocks: number;
  wrapperTag: ?string;
  checkedStateMap: BoolMap

  constructor(contentState: ContentState, checkedStateMap: BoolMap) {
    this.contentState = contentState;
    this.checkedStateMap = checkedStateMap;
  }

  generate(): string {
    this.output = [];
    this.blocks = this.contentState.getBlocksAsArray();
    this.totalBlocks = this.blocks.length;
    this.currentBlock = 0;
    this.indentLevel = 0;
    this.wrapperTag = null;
    while (this.currentBlock < this.totalBlocks) {
      this.processBlock();
    }
    this.closeWrapperTag();
    return this.output.join('').trim();
  }

  processBlock() {
    let block = this.blocks[this.currentBlock];
    let blockType = block.getType();
    let newWrapperTag = getWrapperTag(blockType);
    if (this.wrapperTag !== newWrapperTag) {
      if (this.wrapperTag) {
        this.closeWrapperTag();
      }
      if (newWrapperTag) {
        this.openWrapperTag(newWrapperTag);
      }
    }
    this.indent();
    this.writeStartTag(blockType);
    this.output.push(this.renderBlockContent(block));
    // Look ahead and see if we will nest list.
    let nextBlock = this.getNextBlock();
    if (
      canHaveDepth(blockType) &&
      nextBlock &&
      nextBlock.getDepth() === block.getDepth() + 1
    ) {
      this.output.push(`\n`);
      // This is a litle hacky: temporarily stash our current wrapperTag and
      // render child list(s).
      let thisWrapperTag = this.wrapperTag;
      this.wrapperTag = null;
      this.indentLevel += 1;
      this.currentBlock += 1;
      this.processBlocksAtDepth(nextBlock.getDepth());
      this.wrapperTag = thisWrapperTag;
      this.indentLevel -= 1;
      this.indent();
    } else {
      this.currentBlock += 1;
    }
    this.writeEndTag(blockType);
  }

  processBlocksAtDepth(depth: number) {
    let block = this.blocks[this.currentBlock];
    while (block && block.getDepth() === depth) {
      this.processBlock();
      block = this.blocks[this.currentBlock];
    }
    this.closeWrapperTag();
  }

  getNextBlock(): ContentBlock {
    return this.blocks[this.currentBlock + 1];
  }

  writeStartTag(blockType) {
    let tags = getTags(blockType);
    for (let tag of tags) {
      this.output.push(`<${tag}>`);
    }
  }

  writeEndTag(blockType) {
    let tags = getTags(blockType);
    if (tags.length === 1) {
      this.output.push(`</${tags[0]}>\n`);
    } else {
      let output = [];
      for (let tag of tags) {
        output.unshift(`</${tag}>`);
      }
      this.output.push(output.join('') + '\n');
    }
  }

  openWrapperTag(wrapperTag: string) {
    this.wrapperTag = wrapperTag;
    this.indent();
    this.output.push(`<${wrapperTag}>\n`);
    this.indentLevel += 1;
  }

  closeWrapperTag() {
    if (this.wrapperTag) {
      this.indentLevel -= 1;
      this.indent();
      this.output.push(`</${this.wrapperTag}>\n`);
      this.wrapperTag = null;
    }
  }

  indent() {
    this.output.push(INDENT.repeat(this.indentLevel));
  }

  renderBlockContent(block: ContentBlock): string {
    let blockType = block.getType();
    let text = block.getText();
    if (text === '') {
      // Prevent element collapse if completely empty.
      return BREAK;
    }
    text = this.preserveWhitespace(text);
    let charMetaList: CharacterMetaList = block.getCharacterList();
    let entityPieces = getEntityRanges(text, charMetaList);
    return entityPieces.map(([entityKey, stylePieces]) => {
      let content = stylePieces.map(([text, style]) => {
        let content = encodeContent(text);

        const includedLabels = Object.keys(COLOR_STYLE_MAP).filter(label => !!style.get(label));
        if (includedLabels.length > 0) {
          let styles = {};
          styles = includedLabels.reduce((result, label) => {
            return Object.assign(result, COLOR_STYLE_MAP[label]); // TODO: Object.assign
          }, styles);

          const stringifyStyles = Object.keys(styles).map(prop => {
            return `${decamelize(prop, '-')}: ${styles[prop]};`;
          }).join(' ');
          content = `<span style="${stringifyStyles}">${content}</span>`;
        }

        // These are reverse alphabetical by tag name.
        if (style.has(BOLD)) {
          content = `<strong>${content}</strong>`;
        }
        if (style.has(UNDERLINE)) {
          content = `<ins>${content}</ins>`;
        }
        if (style.has(ITALIC)) {
          content = `<em>${content}</em>`;
        }
        if (style.has(STRIKETHROUGH)) {
          content = `<del>${content}</del>`;
        }
        if (style.has(CODE)) {
          // If our block type is CODE then we are already wrapping the whole
          // block in a `<code>` so don't wrap inline code elements.
          content = (blockType === BLOCK_TYPE.CODE) ? content : `<code>${content}</code>`;
        }
        if (blockType === BLOCK_TYPE.CHECKABLE_LIST_ITEM) {
          const isChecked = this.checkedStateMap[block.getKey()];
          content = `<input type="checkbox" ${(isChecked ? 'checked ' : '')}/>${content}`
        }
        return content;
      }).join('');
      let entity = entityKey ? Entity.get(entityKey) : null;
      let entityType = (entity == null) ? null : entity.getType();

      if (entityType === ENTITY_TYPE.LINK) {
        let attrs = dataToAttr(entityType, entity);
        let strAttrs = stringifyAttrs(attrs);
        return `<a${strAttrs}>${content}</a>`;
      } else if (entityType === ENTITY_TYPE.IMAGE) {
        let attrs = dataToAttr(entityType, entity);
        let strAttrs = stringifyAttrs(attrs);
        return `<a href="${attrs.href}"><img src="${attrs.src}" alt="${attrs.alt}" /></a>`;
      } else {
        return content;
      }
    }).join('');
  }

  preserveWhitespace(text: string): string {
    let length = text.length;
    // Prevent leading/trailing/consecutive whitespace collapse.
    let newText = new Array(length);
    for (let i = 0; i < length; i++) {
      if (
        text[i] === ' ' &&
        (i === 0 || i === length - 1 || text[i - 1] === ' ')
      ) {
        newText[i] = '\xA0';
      } else {
        newText[i] = text[i];
      }
    }
    return newText.join('');
  }

}

function stringifyAttrs(attrs) {
  if (attrs == null) {
    return '';
  }
  let parts = [];
  for (let attrKey of Object.keys(attrs)) {
    let attrValue = attrs[attrKey];
    if (attrValue != null) {
      parts.push(` ${attrKey}="${encodeAttr(attrValue)}"`);
    }
  }
  return parts.join('');
}

function canHaveDepth(blockType: string): boolean {
  switch (blockType) {
    case BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case BLOCK_TYPE.ORDERED_LIST_ITEM:
    case BLOCK_TYPE.CHECKABLE_LIST_ITEM:
      return true;
    default:
      return false;
  }
}

function encodeContent(text: string): string {
  return text
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('\xA0').join('&nbsp;')
    .split('\n').join(BREAK + '\n');
}

function encodeAttr(text: string): string {
  return text
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

export default function stateToHTML(content: ContentState, checkedStateMap: BoolMap): string {
  return new MarkupGenerator(content, checkedStateMap).generate();
}
