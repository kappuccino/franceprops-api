import {createReadStream} from 'fs'
import {readdir, readFile, writeFile, mkdir, stat, copyFile, rmdir, unlink} from 'fs/promises'
import {dirname} from 'path'
import {createHash} from 'crypto'

import {mongoIdToFolder} from '../../app/tools.js'
import {prompt} from '../../app/media/media.js'


function sanytise_path(path){

	// We want an absolute path
	if(path.substring(0, 1) !== '/') return '/' + path

	return path
}

//--

export async function save(local, remote){

	const dest = process.env.STORAGE_ROOT + sanytise_path(remote)
	const folder = dirname(dest)

	try{
		await stat(folder)
	} catch(e){
		await mkdir(folder, 0o755)
	}

	try{
		await stat(dest)
		await unlink(dest)
	} catch (e){
		// nothing to do
	}

	try{
		await copyFile(local, dest)
	} catch(err){
		throw err
	}

	return remote
}

export async function listFiles(path){

	const folder = process.env.STORAGE_ROOT + sanytise_path(path)

	let files

	try{
		files = await readdir(folder)
	} catch (err){
		files = []
		// nothing to do
	}

	files = (files || []).map(file => folder+'/'+file)

	return files
}

export async function remove(path){

	const file = process.env.STORAGE_ROOT + sanytise_path(path)

	try{
		await stat(file)
		await unlink(file)
	} catch (e) {
		//
	}

	return true
}

export async function removeFolder(path){

	const files = await listFiles(path)

	try {
		await Promise.all(files.map(file => unlink(file)))

		const folder = process.env.STORAGE_ROOT + sanytise_path(path)
		await rmdir(folder)
	} catch (e) {
		throw e
	}

	return true
}

export function getUrl(media){
	return `${process.env.API_URL}/media/${media._id}/${media.name}`
}

export function getPath(media){
	const base = prompt(media) + '/' + mongoIdToFolder(media._id)
	return `${process.env.STORAGE_ROOT}/${base}/${media.url}`
}

export function genKey(media){
	return prompt(media) + '/' + mongoIdToFolder(media._id) + '/' + media.url
}

export async function head(media){

	const path = getPath(media)

	try{
		const info = await stat(path)

		return {
			size: info.size,
			md5: createHash('md5').update(await readFile(path)).digest('hex'),
			updated: info.mtime
		}

	} catch (e) {
		return null
	}
}

export function getBytes(media){
	const path = getPath(media)

	return readFile(path)
}


// —— By key (product pictures: no Media document)

export async function putObject(key, body){
	const dest = process.env.STORAGE_ROOT + sanytise_path(key)

	await mkdir(dirname(dest), {recursive: true})
	await writeFile(dest, body)

	return key
}

// The file as a stream, null when it does not exist
export async function readStream(key){
	const file = process.env.STORAGE_ROOT + sanytise_path(key)

	try{
		await stat(file)
	} catch(e){
		return null
	}

	return createReadStream(file)
}

export async function removeKeys(keys){
	await Promise.all(keys.map(remove))
}
