/**
 * Wikitext [[Image:name|args…]] → figure[data-align] > img + figcaption.
 *
 * Arguments: numbers, `%` and `px` values are width then height (inline
 * style); `left`/`right`/`center` set data-align (start/end/center); `fit`,
 * `box`, `cover` and `contain` are accepted and ignored, as they have been
 * since the Angular-era viewer went; anything else is the caption.
 */
export function getImageTag(args) {
	if (!args) args = {};
	if (!args.name) { console.error('WikiImage.getImage > cannot get image with no name.'); return ''; }

	const imgUrl = args.imgUrl;
	let width = null, height = null, align = null, caption = '';
	for (const arg of args.args ?? []) {
		const isSize = !isNaN(arg) || arg.substr(-1) == '%' || arg.substr(-2) == 'px';
		if (isSize) {
			const size = !isNaN(arg) ? parseFloat(arg) + 'px' : arg;
			if (width == null) width = size;
			else height = size;
			continue;
		}
		if (arg == 'left') { align = 'start'; continue; }
		if (arg == 'right') { align = 'end'; continue; }
		if (arg == 'center') { align = 'center'; continue; }
		if (['fit', 'box', 'cover', 'contain'].includes(arg)) continue;
		caption = arg;
	}

	const style = [width && `width: ${width};`, height && `height: ${height};`].filter(Boolean).join(' ');
	const alignAttr = align ? ` data-align="${align}"` : '';
	const styleAttr = style ? ` style="${style}"` : '';
	const captionHtml = caption ? `<figcaption>${caption}</figcaption>` : '';
	return `<figure${alignAttr}><img src="${imgUrl}" alt="${caption.replace(/"/g, '&quot;')}"${styleAttr}>${captionHtml}</figure>`;
}
