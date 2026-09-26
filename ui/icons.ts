// 16px monochrome line icons, 1.5px stroke, drawn in the current text color.

const svg = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sidebar: svg(
    `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M6.25 2.75v10.5"/>`,
  ),
  folder: svg(
    `<path d="M1.75 4.5a1.5 1.5 0 0 1 1.5-1.5h2.6l1.5 1.6h5.4a1.5 1.5 0 0 1 1.5 1.5v5.9a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z"/>`,
  ),
  settings: svg(
    `<path d="M1.75 4.5h7M12.5 4.5h1.75M1.75 11.5h1.75M7 11.5h7.25"/><circle cx="10.75" cy="4.5" r="1.75"/><circle cx="5.25" cy="11.5" r="1.75"/>`,
  ),
  themeSystem: svg(
    `<circle cx="8" cy="8" r="5.75"/><path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill="currentColor" stroke="none"/>`,
  ),
  themeLight: svg(
    `<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>`,
  ),
  themeDark: svg(
    `<path d="M13.5 9.6A5.75 5.75 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1z"/>`,
  ),
  eye: svg(
    `<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`,
  ),
  closeFile: svg(`<path d="M4 4l8 8M12 4l-8 8"/>`),
  code: svg(`<path d="M5.25 4.5 1.75 8l3.5 3.5M10.75 4.5 14.25 8l-3.5 3.5M9 3 7 13"/>`),
  pin: svg(
    `<path d="M9.75 1.75l4.5 4.5-2.1.7-2.4 2.4-.35 3.15-1.4 1.4L2.1 8l1.4-1.4 3.15-.35 2.4-2.4z"/><path d="M5.1 10.9 1.75 14.25"/>`,
  ),
  zen: svg(
    `<path d="M12.9 5.2A5.75 5.75 0 1 0 13.75 8.3"/><circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none"/>`,
  ),
  close: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>`,
  chevron: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.75 2.25 6.5 5 3.75 7.75"/></svg>`,
};
