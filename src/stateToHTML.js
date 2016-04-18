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

const OLD_COLORS = [
  'rgb(0, 0, 0)', 'rgb(230, 0, 0)', 'rgb(255, 153, 0)', 'rgb(255, 255, 0)',
  'rgb(0, 138, 0)', 'rgb(0, 102, 204)', 'rgb(153, 51, 255)', 'rgb(255, 255, 255)',
  'rgb(250, 204, 204)', 'rgb(255, 235, 204)', 'rgb(255, 255, 204)', 'rgb(204, 232, 204)',
  'rgb(204, 224, 245)', 'rgb(235, 214, 255)', 'rgb(187, 187, 187)', 'rgb(240, 102, 102)',
  'rgb(255, 194, 102)', 'rgb(255, 255, 102)', 'rgb(102, 185, 102)', 'rgb(102, 163, 224)',
  'rgb(194, 133, 255)', 'rgb(136, 136, 136)', 'rgb(161, 0, 0)', 'rgb(178, 107, 0)',
  'rgb(178, 178, 0)', 'rgb(0, 97, 0)', 'rgb(0, 71, 178)', 'rgb(107, 36, 178)',
  'rgb(68, 68, 68)', 'rgb(92, 0, 0)', 'rgb(102, 61, 0)', 'rgb(102, 102, 0)',
  'rgb(0, 55, 0)', 'rgb(0, 41, 102)', 'rgb(61, 20, 10)'
];

const OLD_INLINE_STYLES_SIZE = {
  SIZE_NORMAL: { fontSize: 13 },
  SIZE_SMALLER: { fontSize: 10 },
  SIZE_LARGER: { fontSize: 24 },
  SIZE_HUGE: { fontSize: 32 }
};

const OLD_INLINE_STYLES = OLD_COLORS.reduce((result, color, i) => {
  result[`COLOR${i}`] = { color };
  result[`BACKGROUND_COLOR${i}`] = { backgroundColor: color };
  return result;
}, OLD_INLINE_STYLES_SIZE);

const OLD_BLOCK_TYPES = {
  ALIGN_CENTER: 'align-center',
  ALIGN_RIGHT: 'align-right',
  ALIGN_JUSTIFY: 'align-justify'
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
      if (blockType === OLD_BLOCK_TYPES.ALIGN_RIGHT) {
        this.output.push(`<${tag} style="text-align: right;">`);
      } else if (blockType === OLD_BLOCK_TYPES.ALIGN_CENTER) {
        this.output.push(`<${tag} style="text-align: center;">`);
      } else if (blockType === OLD_BLOCK_TYPES.ALIGN_JUSTIFY) {
        this.output.push(`<${tag} style="text-align: justify;">`);
      } else {
        this.output.push(`<${tag}>`);
      }
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

        const oldStyles = style.toArray()
          .filter(style => Object.keys(OLD_INLINE_STYLES).indexOf(style) !== -1);
        if (oldStyles.length > 0) {
          const styles = oldStyles.reduce((result, style) => {
            return Object.keys(OLD_INLINE_STYLES[style]).reduce((r, prop) => {
              r[prop] = OLD_INLINE_STYLES[style][prop];
              return r;
            }, result);
          }, {});
          const stringifyStyles = Object.keys(styles).map(prop => {
            const val = prop === 'fontSize' ? `${styles[prop]}px` : styles[prop];
            return `${decamelize(prop, '-')}: ${val};`;
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
          content = `<input type="checkbox" ${(isChecked ? 'checked ' : '')}/>${content}`;
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
