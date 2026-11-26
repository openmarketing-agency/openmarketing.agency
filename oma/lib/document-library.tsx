"use client";

/** Selects the read-only OpenUI react-ui components the default agent composes into designed brand, playbook, and research pages. */

import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { z } from "zod/v4";

/** Keeps a model-chosen color to a literal six-digit hex value before it reaches a style attribute. */
export function swatch(hex: string) {
  const value = hex.trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

// OpenUI's library has no color component, so brand palettes get this one addition.
const ColorSwatches = defineComponent({
  name: "ColorSwatches",
  description: "Brand colors as swatches. Use only six-digit hex codes written in the document.",
  props: z.object({
    colors: z.array(z.object({
      name: z.string(), hex: z.string().describe("A six-digit hex code from the document, such as #1A2B3C."),
      usage: z.string().optional().describe("Where the color is used, from the document."),
    })),
  }),
  component: ({ props }) => <ul className="openui-doc-swatches">
    {props.colors.map((color, index) => {
      const hex = swatch(color.hex);
      return <li key={index}>
        <span style={hex ? { background: hex } : undefined} aria-hidden="true" />
        <strong>{color.name}</strong>
        <code>{hex?.toUpperCase() ?? color.hex}</code>
        {color.usage && <small>{color.usage}</small>}
      </li>;
    })}
  </ul>,
});

/** Display components only: no forms, buttons, modals, charts, or remote images. */
export const documentComponents = [
  "Stack", "Card", "CardHeader", "InlineHeader", "TextContent", "MarkDownRenderer", "TextCallout", "Callout", "Separator",
  "Tabs", "TabItem", "Accordion", "AccordionItem", "Steps", "StepsItem", "Table", "Col", "TagBlock", "Tag", "Icon",
  "EntityList", "ListBlock", "ListItem", "SnippetCardBlock", "SnippetCardItem", "OverviewCardBlock", "OverviewCardItem",
  "ContextCardBlock", "ContextCardItem", "CompositeCardBlock", "CompositeCardItem", "Text", "BoldText", "IconText",
  "MetricIndicatorInline",
] as const;

const groups = [
  { name: "Layout", components: ["Stack", "Card", "CardHeader", "InlineHeader", "Separator", "Tabs", "TabItem", "Accordion", "AccordionItem"] },
  { name: "Text", components: ["TextContent", "MarkDownRenderer", "TextCallout", "Callout", "TagBlock", "Tag", "Icon"] },
  { name: "Structured content", components: ["Steps", "StepsItem", "Table", "Col", "EntityList", "ListBlock", "ListItem", "ColorSwatches"] },
  { name: "Card grids", components: [
    "SnippetCardBlock", "SnippetCardItem", "OverviewCardBlock", "OverviewCardItem", "ContextCardBlock", "ContextCardItem",
    "CompositeCardBlock", "CompositeCardItem", "Text", "BoldText", "IconText", "MetricIndicatorInline",
  ] },
];

export const documentLibrary = createLibrary({
  root: "Stack",
  componentGroups: groups,
  components: [...documentComponents.map((name) => openuiLibrary.components[name]), ColorSwatches],
});
