import {dirname} from 'path'
import {createReadStream, createWriteStream} from 'fs'
import {pipeline} from 'stream/promises'
import {readFile, readdir, writeFile, mkdir, unlink, rename, rm, access} from 'fs/promises'

import {mongoIdToFolder, cacheDir} from '../../app/tools.js'

export async function read(file){
	let raw

	try{
		const path = filePath(file)
		raw = await readFile(path)
	} catch(err){
		return null
	}

	return raw
}

export async function write(file, data){

	const path = filePath(file)
	const dir = dirname(path)

	try{
		await mkdir(dir, {recursive: true})
		await writeFile(path, data)
	} catch(err){
		return false
	}

	return true
}

export async function clear(_id){
	const dir = filePath(mongoIdToFolder(_id, true))

	try{
		let files = await readdir(dir)
		files = files.map(file => dir + '/' + file)
		if(files?.length) await Promise.all(files.map(file => unlink(file)))
	} catch(e){
		// silent
	}

}

// The cached file as a stream, null when it is not there
export async function readStream(file){
	const path = filePath(file)

	try{
		await access(path)
	} catch(err){
		return null
	}

	return createReadStream(path)
}

// Streams piped into a temp file, renamed into place: a concurrent reader
// never sees a partial file (rename is atomic on the same filesystem)
export async function writeStream(file, ...streams){
	const path = filePath(file)
	const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

	await mkdir(dirname(path), {recursive: true})

	try{
		await pipeline(...streams, createWriteStream(tmp))
		await rename(tmp, path)
	} catch(err){
		await unlink(tmp).catch(() => {})
		throw err
	}
}

export async function removeDir(dir){
	await rm(filePath(dir), {recursive: true, force: true})
}

function filePath(file){
	return cacheDir() + '/' + file
}
