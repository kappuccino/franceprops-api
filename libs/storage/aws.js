import {readFile} from 'fs/promises'
import mime from 'mime'
import {S3Client} from '@aws-sdk/client-s3'
import {PutObjectCommand, ListObjectsCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3'

import {mongoIdToFolder} from '../../app/tools.js'
import {prompt} from '../../app/media/media.js'

// Singleton: the SDK pools its sockets per client, a client per call meant a
// TCP/TLS handshake per request (models-api, AUDIT-MEDIA P3)
let awsClient

function getAwsClient(){
	if(awsClient) return awsClient

	awsClient = new S3Client({
		region: process.env.AWS_REGION,
		// S3 compatible provider (e.g. Scaleway), AWS when empty
		endpoint: process.env.AWS_ENDPOINT || undefined,
		credentials: {
			accessKeyId: process.env.AWS_KEY,
			secretAccessKey: process.env.AWS_SECRET,
		},
		// Wider pool, and a stuck socket is dropped instead of held forever
		requestHandler: {
			connectionTimeout: 5000,
			requestTimeout: 30000,
			httpsAgent: {maxSockets: 256}
		}
	})

	return awsClient
}

function sanytise_key(key){

	// We don't need a / on front of the key
	if(key.substring(0, 1) === '/') return key.substr(1)

	return key
}

//--

export async function save(local, key){
	const client = getAwsClient()

	let data

	try {
		data = await readFile(local)
	} catch (e) {
		throw e
	}

	const params = {
		//ACL: 'public-read',
		Bucket: process.env.AWS_S3_BUCKET,
		Key: sanytise_key(key),
		Body: data,
		ContentType: mime.getType(key, 'application/octet-stream')
	}

	try {
		const command = new PutObjectCommand(params)
		await client.send(command)
	} catch(e){
		console.log(e)
		throw e
	}

	return key
}

export async function listFiles(prefix){

	const client = getAwsClient()

	let data

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Prefix: sanytise_key(prefix)
	}

	try{
		const command = new ListObjectsCommand(params)
		data = await client.send(command)
	} catch (e) {
		throw e
	}

	if(!data || !data.Contents || !data.Contents.length) return []

	return data.Contents
			.map(Content => ({Key: Content.Key}))
			.sort((a,b) => a.Key < b.Key)

}

export async function remove(path){

	const client = getAwsClient()

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Key: sanytise_key(path)
	}

	try {
		const command = new DeleteObjectCommand(params)
		await client.send(command)
	} catch (e) {
		throw e
	}

	return true
}

export async function removeFolder(path){

	const client = getAwsClient()

	const prefix = sanytise_key(path)
	const files = await listFiles(prefix)

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Delete: {
			Objects: files,
			Quiet: false
		}
	}

	try {
		const command = new DeleteObjectsCommand(params)
		await client.send(command)
	} catch (e) {
		throw e
	}

	return true
}

export async function getSignedUrl(key){

	const client = getAwsClient()

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Key: sanytise_key(key),
		Range: "bytes=0-9"
	}

	const command = new GetObjectCommand(params)
	return client.send(command) //().getSignedUrlPromise('getObject', params);
}

export function getUrl(media){
	const base = prompt(media) + '/' + mongoIdToFolder(media._id)
	const endpoint = process.env.AWS_ENDPOINT || `https://s3.${process.env.AWS_REGION}.amazonaws.com`
	return `${endpoint}/${process.env.AWS_S3_BUCKET}/${base}/${media.url}`
}

export function genKey(media){
	const base = prompt(media) + '/' + mongoIdToFolder(media._id)
	return `${base}/${media.url}`
}

// Size and checksum of the stored object, without downloading it
// The ETag is the MD5 of the content for a plain PutObject (what save() does),
// but not for a multipart upload: it then ends with "-<parts>" and cannot be
// compared to a local MD5
export async function head(media){

	const client = getAwsClient()

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Key: genKey(media)
	}

	try{
		const res = await client.send(new HeadObjectCommand(params))
		const etag = (res.ETag || '').replaceAll('"', '')

		return {
			size: res.ContentLength,
			md5: etag.includes('-') ? null : etag,
			updated: res.LastModified
		}

	} catch (e) {
		if(e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null
		throw e
	}
}

export async function getBytes(media){

	const client = getAwsClient()

	const params = {
		Bucket: process.env.AWS_S3_BUCKET,
		Key: genKey(media)
	}

	const command = new GetObjectCommand(params)

	try{
		const res = await client.send(command)
		return res.Body?.transformToByteArray()
	} catch (e) {
		throw e
	}
}



// —— By key (product pictures: no Media document)

export async function putObject(key, body, contentType){
	await getAwsClient().send(new PutObjectCommand({
		Bucket: process.env.AWS_S3_BUCKET,
		Key: sanytise_key(key),
		Body: body,
		ContentType: contentType || mime.getType(key) || 'application/octet-stream'
	}))

	return key
}

// The body as a stream, null when the key does not exist
export async function readStream(key){
	try{
		const res = await getAwsClient().send(new GetObjectCommand({
			Bucket: process.env.AWS_S3_BUCKET,
			Key: sanytise_key(key)
		}))

		return res.Body
	} catch(e){
		if(e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null
		throw e
	}
}

// A missing key is not an error (S3 answers the same)
export async function removeKeys(keys){
	for(let i = 0; i < keys.length; i += 1000){
		await getAwsClient().send(new DeleteObjectsCommand({
			Bucket: process.env.AWS_S3_BUCKET,
			Delete: {
				Objects: keys.slice(i, i + 1000).map(key => ({Key: sanytise_key(key)})),
				Quiet: true
			}
		}))
	}
}
