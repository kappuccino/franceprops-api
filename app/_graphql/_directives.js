import {defaultFieldResolver} from 'graphql'
import {mapSchema, getDirective, MapperKind} from '@graphql-tools/utils'

import {isAdmin, unauthorized} from './_helper.js'

// `@admin` on a Query/Mutation field: only admins and superadmins may run it
export const directiveTypeDefs = `
	directive @admin on FIELD_DEFINITION
`

export function adminDirective(schema){
	return mapSchema(schema, {
		[MapperKind.OBJECT_FIELD]: fieldConfig => {
			if(!getDirective(schema, fieldConfig, 'admin')?.[0]) return fieldConfig

			const {resolve = defaultFieldResolver} = fieldConfig

			return {
				...fieldConfig,
				resolve(source, args, context, info){
					if(!isAdmin(context)) unauthorized()
					return resolve(source, args, context, info)
				}
			}
		}
	})
}
