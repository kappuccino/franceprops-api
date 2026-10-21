import {writeFile} from 'fs/promises'

import * as aws from './aws.js'
import * as local from './local.js'
import {tempFileName} from '../../app/tools.js'

export async function save(file, remote){
	if(getStrategy() === 'aws') return aws.save(file, remote)
	return local.save(file, remote)
}

export async function remove(path){
	if(getStrategy() === 'aws') return aws.remove(path)
	return local.remove(path)
}

export async function removeFolder(path){
	if(getStrategy() === 'aws') return aws.removeFolder(path)
	return local.removeFolder(path)
}

export async function list(path){
	if(getStrategy() === 'aws') return aws.listFiles(path)
	return local.listFiles(path)
}

export function getPath(media){
	if(getStrategy() === 'local') return local.getPath(media)
	throw new Error('getPath is not relevent for remote storage')
}

export function getBytes(media){
	if(getStrategy() === 'aws') return aws.getBytes(media)
	return local.getBytes(media)
}

// {size, md5, updated} of the stored file, null when it does not exist
export function head(media){
	if(getStrategy() === 'aws') return aws.head(media)
	return local.head(media)
}

// Path of the file inside the storage, relative to its root
export function getKey(media){
	if(getStrategy() === 'aws') return aws.genKey(media)
	return local.genKey(media)
}

export function getUrl(media){
	if(getStrategy() === 'aws') return aws.getUrl(media)
	return local.getUrl(media)
}

// —— By key (product pictures: no Media document)

export function putObject(key, body, contentType){
	if(getStrategy() === 'aws') return aws.putObject(key, body, contentType)
	return local.putObject(key, body)
}

// The stored file as a stream, null when it does not exist
export function readStream(key){
	if(getStrategy() === 'aws') return aws.readStream(key)
	return local.readStream(key)
}

export function removeKeys(keys){
	if(!keys.length) return
	if(getStrategy() === 'aws') return aws.removeKeys(keys)
	return local.removeKeys(keys)
}

export function getStrategy(){
	return process.env.STORAGE
}

export function isLocalStrategy(){
	return getStrategy() === 'local'
}

export async function copyTemp(media){

	const temp = tempFileName(media.url)
	const bytes = await getBytes(media)

	await writeFile(temp, bytes)

	return temp
}
