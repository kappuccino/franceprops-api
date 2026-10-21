import {isValidId} from '../../picture/picture.js'

// Pictures of a source product → {picture, gallery} of FranceProps: the main
// one apart, the others in the order of the source, each one once. A picture
// without a usable id (it goes into the storage key) or url is skipped.
// main: the main media when the source has a field for it (Defrise, Lanzani),
// else the gallery item flagged main, else the first one (XXO).
export function pictures(main, gallery=[]){
	const items = [...gallery].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
	const first = main || items.find(item => item.main)?.media || items[0]?.media

	const seen = new Set()
	const isNew = media => {
		if(!isValidId(media?._id) || !/^https?:\/\//.test(media.url || '') || seen.has(String(media._id))) return false
		seen.add(String(media._id))
		return true
	}

	const toPicture = media => ({sourceId: String(media._id), sourceUrl: media.url, width: media.width, height: media.height})

	return {
		picture: isNew(first) ? toPicture(first) : null,
		gallery: items.map(item => item.media).filter(isNew).map(toPicture)
	}
}

// Urls of the pictures listed, in the listing hash: a cut-out at the source
// changes the url of the picture, not always the date of the product
export function pictureUrls(main, gallery=[]){
	return [main?.url, ...gallery.map(item => item.media?.url)].filter(Boolean)
}
