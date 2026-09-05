declare module "deckrun/dist/parser.js" {
  export interface PositionedImage {
    src: string;
    alt: string;
    opacity: number;
  }
  export interface Slide {
    html: string;
    bgImage?: PositionedImage;
    rightImage?: PositionedImage;
    leftImage?: PositionedImage;
    notes?: string;
  }
  export function parseSlides(markdown: string): Slide[];
}

declare module "deckrun/dist/generate.js" {
  import type { Slide } from "deckrun/dist/parser.js";
  export interface PresentationOptions {
    template?: string;
    transition?: string;
    standalone?: boolean;
  }
  export function generateHtml(
    slides: Slide[],
    title: string,
    autoFullscreen?: boolean,
    themeInput?: string,
    sizeInput?: string,
    fonts?: { head?: string; body?: string },
    presentation?: PresentationOptions,
  ): string;
}

declare module "deckrun/dist/themes.js" {
  export const THEME_IDS: string[];
  export const DEFAULT_THEME: string;
  export const FONT_IDS: string[];
  export function findTheme(input: string): string | undefined;
  export function findFont(input: string | undefined): string | undefined;
}

declare module "deckrun/dist/presentation-options.js" {
  export const TEMPLATE_IDS: string[];
  export const TRANSITION_IDS: string[];
  export const DEFAULT_TEMPLATE: string;
  export const DEFAULT_TRANSITION: string;
  export function findTemplate(input: string): string | undefined;
  export function findTransition(input: string): string | undefined;
}
