import {defaultFieldResolver} from 'graphql'
import {mapSchema, getDirective, MapperKind} from '@graphql-tools/utils'

import {isAdmin, isService, unauthorized} from './_helper.js'

// Role directives on Query/Mutation fields:
//   @admin    admins and superadmins only
//   @service  service accounts only (the website Nuxt server)
const roles = {
	admin: isAdmin,
	service: isService,
}

export const directiveTypeDefs = Object.keys(roles)
	.map(name => `directive @${name} on FIELD_DEFINITION`)
	.join('\n')

export function roleDirectives(schema){
	return mapSchema(schema, {
		[MapperKind.OBJECT_FIELD]: fieldConfig => {
			const checks = Object.entries(roles)
				.filter(([name]) => getDirective(schema, fieldConfig, name)?.[0])
				.map(([, check]) => check)

			if(!checks.length) return fieldConfig

			const {resolve = defaultFieldResolver} = fieldConfig

			return {
				...fieldConfig,
				resolve(source, args, context, info){
					if(!checks.some(check => check(context))) unauthorized()
					return resolve(source, args, context, info)
				}
			}
		}
	})
}
