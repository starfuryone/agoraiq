declare module "sanitize-html" {
  interface IOptions {
    allowedTags?: string[];
    allowedAttributes?: Record<string, string[]>;
    allowedStyles?: Record<string, any>;
    allowedSchemes?: string[];
    disallowedTagsMode?: string;
    transformTags?: Record<string, (tagName: string, attribs: Record<string, string>) => { tagName: string; attribs: Record<string, string> }>;
    exclusiveFilter?: (frame: { tag: string }) => boolean;
  }
  function sanitize(dirty: string, options?: IOptions): string;
  export = sanitize;
}
