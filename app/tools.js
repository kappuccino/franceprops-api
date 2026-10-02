import mongoose from 'mongoose'
import path from 'path'
import nodemailer from 'nodemailer'
import {randomBytes, randomUUID} from 'crypto'
import {nanoid} from 'nanoid'

import {getBySlug as getTemplateBySlug} from './template/template.js'
import {getDefault as getSettings} from './settings/settings.js'
import {create as createMailQueue} from './mail-queue/mail-queue.js'
import {setex} from './redis.js'

// 👍
export function escapeRegex(str){
	return (str || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function diacriticRegex(str){
	return str.toLowerCase()
		.replaceAll("a", "[a,à,á,â,ã,ä,å]")
		.replaceAll("b", "[b,þ]")
		.replaceAll("c", "[c,¢,Ç]")
		.replaceAll("e", "[e,è,é,ê,ë]")
		.replaceAll("f", "[f,ƒ]")
		.replaceAll("i", "[i,ì,î,í,ï]")
		.replaceAll("n", "[n,ñ]")
		.replaceAll("o", "[o,ð,ò,ó,ô,õ,ö,ø]")
		.replaceAll("s", "[s,š]")
		.replaceAll("u", "[u,µ,ù,ú,û,ü]")
		.replaceAll("y", "[y,ý]")
		.replaceAll("z", "[z,ž]")
}

export function sanitizeSearch(query, opt={}){

	let _id, limit, skip, sort
	const noLimit = !!opt.noLimit

	// ID
	if('_id' in opt){
		_id = opt._id

		if('object' === typeof _id && _id.length){
			_id = _id.map((id) => new mongoose.Types.ObjectId(id))
			query.where('_id').in(_id)
		}else
		if('string' === typeof _id){
			_id = new mongoose.Types.ObjectId(_id)
			query.where('_id').equals(_id)
		}
	}

	// SORT
	if('sort' in opt){
		sort = opt['sort']

		// On envois une string, elle sera consuite en {} (voir complexe)
		if('string' === typeof sort){
			sort = sort
				.split('|')
				.reduce((acc, next) => {
					(next.substring(0, 1) === '-') ? acc[next.substring(1)] = -1 : acc[next] = 1
					return acc
				}, {})
		}

		// Simple (1 champ)
		if('string' === typeof sort) query.sort(sort)

		// Complexe {truc: 1, muche: -1, machin: 1}
		if('object' === typeof sort) query.sort(sort)
	}

	// LIMIT
	if(!noLimit && 'limit' in opt){
		limit = parseInt(opt.limit)
		if(!limit) limit = 100
		query.limit(limit)
	}

	// SKIP
	if(!noLimit && 'skip' in opt){
		skip = parseInt(opt.skip)
		if(!isNaN(skip)) query.skip(skip)
	}

	return query
}

// 👍
export function sanitizeAggregate(agg, params={}){

	const next = [...agg]
	const noLimit = params.noLimit || false

	if(Object.keys(params?.sort || {}).length > 0){
		next.push({$sort: params.sort})
	}

	if(!noLimit && params?.skip >= 0){
		next.push({$skip: params?.skip})
	}

	if(!noLimit && params?.limit >= 0){
		next.push({$limit: params?.limit})
	}

	return next
}

// Temporary files folder (uploads, resizes), defaults to ./temp
export function tempDir(){
	return process.env.STORAGE_TEMP || process.cwd() + '/temp'
}

// Thumbnails cache folder, defaults to the cache/ subfolder of the temp folder
export function cacheDir(){
	return process.env.STORAGE_CACHE || tempDir() + '/cache'
}

// ⭐️
export function tempFileName(src, ext = null, prefix = false, fullPath = true){

	const file = path.basename(src)

	ext = ext || path.extname(src)

	const start = prefix ? file.substring(0, file.length-ext.length) + '_' : ''
	const random = nanoid(10)

	const filePath = `${tempDir()}/${start}${random}${ext}`

	return fullPath ? filePath : path.basename(filePath)
}


/**
 * Determine le nombre total de donnée sans limit()
 *
 * @param query
 *
 */
export function queryTotal(query) {

	return new Promise((resolve, reject) => {
		query.model.collection.countDocuments(query._conditions, (err, total) => {
			if(err) return reject(err)
			resolve(total)
		})
	})

}

/**
 * Recupère les résultats de la recherche
 *
 * @param query object
 * @param populate string List of fields (mongoose populate)
 *
 */
export function queryResult(query, populate){

	/*console.log(
		'-- 🦄 queryResult conditions --',
		JSON.stringify(query._conditions, null, 2),
		JSON.stringify(query.options, null, 2),
		'----------------------------'
	)*/

	if(populate) query.populate(populate)

	return new Promise((resolve, reject) => {
		query.exec((err, docs) => {
			if(err) return reject(err)
			resolve(docs)
		})
	})

}

export function tempFile(src, ext=null){
	const file = path.basename(src)

	ext = ext || path.extname(src)
	return `${file.substring(0, file.length-ext.length)}_${nanoid(10)}${ext}`
}

export function tempRandFile(src, ext=null){
	ext = ext || path.extname(src)
	return `${nanoid(10)}${ext}`
}

function createMailTransporter(){
	let auth = {}
	if(process.env.SMTP_USER) auth.user = process.env.SMTP_USER
	if(process.env.SMTP_PASS) auth.pass = process.env.SMTP_PASS

	return nodemailer.createTransport({
		service: 'Mailjet',
		auth
	})
}

// Brand identity used in outgoing mails, from settings (fallback: env, then "French Props")
export async function getMailBrand(){
	const settings = await getSettings() || {}
	const name = settings.brandName || process.env.MAIL_SENDER_NAME || 'French Props'
	const prefix = settings.mailSubjectPrefix || `[${name}]`

	return {name, prefix}
}

// data.tag (or the template slug) tells where the mail comes from in the mail-queue
export async function sendMail(data){

	const brand = await getMailBrand()
	const mailID = randomUUID()

	// Only used to build the mail, never handed over to nodemailer
	const {tag, useTemplate, variables, ...mail} = data

	const options = {
		from: `${brand.name} <${process.env.MAIL_FROM}>`,
		replyTo: `${brand.name} <${process.env.MAIL_REPLY}>`,
		...mail,
	}

	if(useTemplate){
		const template = await getTemplateBySlug(useTemplate)
		if(!template) throw new Error(`mail template "${useTemplate}" not found`)

		mail.subject = template.title
		mail.text = template.content
	}

	// Subjects are stored without the entity prefix
	if(mail.subject && !mail.subject.startsWith(brand.prefix)){
		options.subject = `${brand.prefix} ${mail.subject}`
	}

	// A mail resent from the mail-queue already holds its headers and body.
	// Without a Mailjet template the body is sent as is: the template is the only
	// thing that turns x-mj-vars into content, the mail would be empty otherwise
	if(!mail.headers && !process.env.MAIL_TEMPLATE){
		const text = computedEmailVariables(mail.text || '', variables)
		options.text = text
		options.html = mail.html
			? computedEmailVariables(mail.html, variables)
			: text.replaceAll('\n', '<br>')
	}

	if(!mail.headers && process.env.MAIL_TEMPLATE){
		let content = (mail.html || mail.text || '').replaceAll('\n', '<br>')
		content = computedEmailVariables(content, variables)

		options.headers = {
			'x-mj-templateid': process.env.MAIL_TEMPLATE,
			'x-mj-templatelanguage': '1',
			'x-mj-vars': JSON.stringify({ // https://dev.mailjet.com/smtp-relay/custom-headers/
				title: mail.subject,
				content
			})
		}
	}

	// Ties the Mailjet webhook events (bounce, blocked, spam) to the mail-queue entry
	options.headers = {...options.headers, 'x-mj-eventpayload': mailID}

	// Every mail is kept (sent or not) so it can be resent, a failure here must not mask the SMTP result
	async function queueMail(status, error){
		try {
			await createMailQueue({id: mailID, tag: tag || useTemplate, status, error, raw: options})
		} catch(err){
			console.log('[sendMail] mail-queue failed', err.message)
		}
	}

	return new Promise((resolve, reject) => {

		if(process.env.MAIL_FAKE) {
			console.log('🦄 Fake ! (mail not sent)')
			return resolve('🦄 Fake ! (mail not sent)')
		}

		const transporter = createMailTransporter()

		transporter.sendMail(options, async (error, info) => {
			if(error){
				await queueMail('error', error.response || error.message)
				return reject(error)
			}

			console.log('Message sent: %s', info.messageId)
			await queueMail('sent')

			resolve(true)
		})

	})

}

function computedEmailVariables(content, variables={}){
	let theContent = content
	Object.entries(variables).forEach(([key, value]) => {
		const tag = `*|${key.toUpperCase()}|*`
		theContent = theContent.replaceAll(tag, value)
	})

	return theContent
}

export function mongoIdToFolder(_id, useSub=false){
	if(!useSub) return _id

	const id = _id.toString()

	const tmp = [
		id.substring(0, 4),
		id.substring(4)
	]

	return tmp.join('/')
}

export function arrayChunk(arr, size) {
	return Array.from(
		{ length: Math.ceil(arr.length / size) },
		(v, i) => arr.slice(i * size, i * size + size)
	)
}

export function arrayFillSize(array, int){

	const rest = int - (array.length % int)
	if(rest === 0) return array

	const filler = Array.from({length: rest}, () => ({}))
	return [...array, ...filler]
}

export function validateEmail(email) {
	if(!email || typeof email !== 'string') return
	const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
	return re.test(String(email).toLowerCase());
}

function makeSort(sort){
	return sort.reduce((acc, next) => {
		acc[next.field] = next.direction
		return acc
	}, {})
}

export async function generateMagicLink(jwt, appendToUrl=null){

	const token = randomBytes(32).toString('hex')

	if(token){
		await setex(`magiclink:${token}`, 7 * 24 * 60 * 60, jwt)

		let url = `${process.env.WEB_URL}/magiclink/${token}`
		if(appendToUrl) url += appendToUrl

		return url
	}

	return process.env.WEB_URL
}

export function isBoolean(v){
	return v === true || v === false
}

export function removeNestedField(obj, field, depth=0){

	//console.log(field, depth)

	if(field in obj) delete obj[field]

	// Entry : [key, value] for every props in this object
	for (let entry of Object.entries(obj)){
		let value = entry[1]

		// Pas un array ou vide
		if(!Array.isArray(value)) continue
		if(!value.length) continue

		// Les items de l'array ne sont pas des objets
		if('object' !== typeof value[0]) continue

		// Doit contenir field
		if(!Object.keys(value[0]).includes(field)) continue

		// Supprimer le champ `field`
		value.forEach(v => {
			delete v[field]
			removeNestedField(v, field, depth+1)
		})

	}

	return obj
}

export function fixFloat(float, digits = 2){
	if(float === undefined || float === null || float === '') return null
	return parseFloat(float.toFixed(digits))
}


//------------------------------------------------------------------------------------
// ▼ EXPERIMENTAL ▼
//------------------------------------------------------------------------------------


/**
 * Fonction utilitaire pour comparer deux valeurs en profondeur
 * Gère : Primitifs, Dates, ObjectIds, Arrays, et Objets imbriqués
 */
export function isEquivalent(a, b) {
	// 1. Égalité stricte (couvre null, undefined, string, number, boolean, et mêmes refs)
	if (a === b) return true;

	// 2. Gestion des null/undefined (si l'un est null et pas l'autre, c'est faux car a!==b a échoué)
	if (a === null || a === undefined || b === null || b === undefined) return false;

	// 3. Gestion des Dates
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() === b.getTime();
	}
	// Cas où l'un est Date et l'autre String (ex: payload JSON)
	if (a instanceof Date && typeof b === 'string') {
		return a.getTime() === new Date(b).getTime();
	}
	if (b instanceof Date && typeof a === 'string') {
		return new Date(a).getTime() === b.getTime();
	}

	// 4. Gestion des Mongoose ObjectIds
	if (a instanceof mongoose.Types.ObjectId || b instanceof mongoose.Types.ObjectId) {
		return a.toString() === b.toString();
	}

	// 5. Gestion des Tableaux (Simple Arrays)
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		// On compare chaque élément récursivement
		for (let i = 0; i < a.length; i++) {
			if (!isEquivalent(a[i], b[i])) return false;
		}
		return true;
	}

	// 6. Gestion des Objets (Plain Objects)
	if (typeof a === 'object' && typeof b === 'object') {
		// Si c'est un objet Mongoose, on le convertit en objet simple pour comparer les données
		const objA = a.toObject ? a.toObject() : a;
		const objB = b.toObject ? b.toObject() : b;

		const keysA = Object.keys(objA);
		const keysB = Object.keys(objB);

		if (keysA.length !== keysB.length) return false;

		for (const key of keysA) {
			if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
			if (!isEquivalent(objA[key], objB[key])) return false;
		}
		return true;
	}

	return false;
}

export function prepareUpdate($doc, data, level=0){

	//console.log('--- prepareUpdate ---', level)

	// On récupère les options du schéma pour savoir si le mode "strict" est désactivé
	// (Si strict: false, on accepte tout, même hors schéma)
	const isStrictSchema = $doc.schema.options.strict !== false;

	for(const [key, newValue] of Object.entries(data)){

		// 1. On demande au Schéma : "C'est quoi ce champ ?"
		const schemaType = $doc.schema.path(key);

		// 2. FILTRAGE BASÉ SUR LE SCHÉMA
		// Si le champ n'est pas défini dans le schéma ET qu'on est en mode strict (défaut)
		// => ON IGNORE (Skip)
		if (!schemaType && isStrictSchema) {
			// On ignore silencieusement (ou avec log si debug)
			// Cela élimine __typename, id (virtuel), et les typos
			//if (level > 1)
			console.log(`-- IGNORE (hors schéma) : ${key}`);
			continue;
		}

		// Note : Si schemaType est undefined mais que isStrictSchema est false,
		// on continue, et le .set() plus bas ajoutera le champ "Mixed" dynamique.

		const isDocumentArray = schemaType && schemaType instanceof mongoose.Schema.Types.DocumentArray

		// Array of document
		if(isDocumentArray && Array.isArray(newValue)){
			const docArray = $doc.get(key)
			const addedIds = []

			newValue.forEach(itemData => {
				if(itemData._id){
					// Cas A : ID fourni -> On cherche l'existant
					const existingSubDoc = docArray.id(itemData._id)

					if(existingSubDoc){
						// On met à jour l'instance existante (Garde isNew: false, active isModified)
						console.log(`🟢 (${key})`)
						prepareUpdate(existingSubDoc, itemData, level+1)

						//console.log(itemData)
						//existingSubDoc.set(itemData)
					}else{
						console.log(`🔴 (${key})`)
						// Cas rare : ID fourni mais introuvable -> On ajoute
						docArray.push(itemData)
					}
				}else{
					console.log(`🟠 (${key})`)
					// Cas B : Pas d'ID -> C'est un ajout (isNew: true)
					docArray.push(itemData)
					addedIds.push(docArray.at(-1).get('_id').toString())
				}
			})

			// 2. SUPPRESSION
			// On liste les IDs présents dans la nouvelle data (convertis en String pour comparaison fiable)
			const incomingIds = newValue
				.filter(item => item._id)
				.map(item => item._id.toString())

			// On parcourt le tableau actuel à l'envers (bonne pratique quand on supprime des éléments)
			// ou on utilise filter, mais .pull() est plus "Mongoose way"
			for(let i = docArray.length - 1; i >= 0; i--){
				const subDoc = docArray[i]
				const _subDoc = subDoc._id.toString()

				// Ne pas supprimer les nouveaux ajouts
				if(addedIds.includes(_subDoc)) continue

				// Si le sous-doc a un ID (il est persisté) ET qu'il n'est pas dans les nouvelles data
				if(!incomingIds.includes(_subDoc)){
					console.log(`🗑️  Suppression dans (${key}) :`, _subDoc)
					docArray.pull(subDoc._id)
				}
			}

		}

		// Simpler fields
		else{
			const currentValue = $doc.get(key)
			if(isEquivalent(currentValue, newValue)){
				if(level > 1) console.log(`-- NO CHANGE (${key})`, currentValue, newValue)
				continue
			}

			if(level > 1) console.log(`++ Modif (${key}) detected`)
			$doc.set(key, newValue)
		}

	}

	return $doc
}
