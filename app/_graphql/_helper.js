import { GraphQLError } from 'graphql'

import {mediaSize, createThumbnailUrl} from '../../libs/media/media.js'
import {getConfig as getTheConfig} from '../config/config.js'
import dayjs from '../dayjs.js'
import * as mediaApi from '../media/media.js'
import * as userApi from '../user/user.js'

export const getConfig = getTheConfig

export function allowed(context){
	return Boolean(context?.user?._id)
}

export function isAdmin(context){
	return ['admin', 'superadmin'].includes(context?.user?.role)
}

// Admins reach every tenant, the others only theirs (user._tenants)
export function canAccessTenant(context, _tenant){
	if(!_tenant) return false
	if(isAdmin(context)) return true
	return (context?.user?._tenants || []).some(t => t.toString() === _tenant)
}

export function unauthorized(msg){
	throw new GraphQLError(msg || "You are not authorized", {
		extensions: { code: 'UNAUTHORIZED' },
	})
}

export async function getMedia(_id, args = {}){
	if(!_id) return null

	let media = await mediaApi.getById(_id)
	if(!media) return null

	if(!Object.keys(args).length) return media

	const {height, width} = mediaSize(media)

	if(args.width > 0 || args.height > 0){
		let {height: urlHeight, width: urlWidth} = args

		if(args.width > 0 && args.height > 0){
			if(height > width){
				urlWidth = 0
			}else{
				urlHeight = 0
			}
		}

		if(urlWidth > 0){
			media.url = createThumbnailUrl(media, 'width', urlWidth)
			media.width = urlWidth
			media.height = (height > 0 && width > 0) ? Math.round((height / width) * urlWidth) : 0
		}

		if(urlHeight > 0){
			media.url = createThumbnailUrl(media, 'height', urlHeight)
			media.height = urlHeight
			media.width = (height > 0 && width > 0) ? Math.round((width / height) * urlHeight) : 0
		}

	}

	return media
}

export function sanitiseDate(date, format){
	if(!date) return null

	return dayjs.utc(date).format(format)
}

export function genFailedMutation(error, context){
	return {
		success: false,
		message: error.message,
		stack: context?.isDev
			? (error.stack || '').split('\n')
			: null
	}
}

export async function getCountryName(iso, name){
	if(name) return name
	if(!iso) return null

	const country = await getTheConfig('countries', iso)
	if(!country) return iso

	return country.name || iso
}

export async function getUser(_id, user){
	if(user) return user
	if(!_id) return null
	return userApi.getById(_id)
}

export function empty(){
	return null
}
