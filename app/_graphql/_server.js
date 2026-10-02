import {ApolloServer} from '@apollo/server'
import {gql as ApolloGQL} from 'graphql-tag'
import {expressMiddleware} from '@as-integrations/express5'
import {InMemoryLRUCache} from '@apollo/utils.keyvaluecache'
import {makeExecutableSchema} from '@graphql-tools/schema'
import express from 'express'
import cors from 'cors'
import 'graphql-type-json'

import Token from './Token.js'
import User from './User.js'
import Auth from './Auth.js'
import Media from './Media.js'
import Template from './Template.js'
import Config from './Config.js'
import Settings from './Settings.js'
import MailQueue from './MailQueue.js'
import Tenant from './Tenant.js'

import debug from './_debug.js'
import {dateScalar} from './_scalar.js'
import authPlugin from './_auth.js'
import {directiveTypeDefs, adminDirective} from './_directives.js'

const debugGraphQL = false

const Schema = `
	scalar JSONObject
	scalar Date	
  
  schema {
    query: RootQuery
    mutation: RootMutation
  }
  
  type GenericMutation{
		success: Boolean
		message: String
		stack: [String]
	}
	
	type RootQuery{
		${Token.Query}
		${User.Query}
		${Auth.Query}
		${Media.Query}

		${Config.Query}
		${Settings.Query}

		${Template.Query}
		${MailQueue.Query}

		${Tenant.Query}
	}
	
	type RootMutation{
		${Token.Mutation}
		${User.Mutation}
		${Auth.Mutation}
		${Media.Mutation}

		${Config.Mutation}
		${Settings.Mutation}

		${Template.Mutation}
		${MailQueue.Mutation}

		${Tenant.Mutation}
	}
`

// Built here (not by Apollo) so the @admin directive can wrap the resolvers
const schema = adminDirective(makeExecutableSchema({
	typeDefs: [
		directiveTypeDefs,
		Schema,
		...Token.TypeDefs,
		...User.TypeDefs,
		...Auth.TypeDefs,
		...Media.TypeDefs,

		...Config.TypeDefs,
		...Settings.TypeDefs,

		...Template.TypeDefs,
		...MailQueue.TypeDefs,

		...Tenant.TypeDefs,
	],

	resolvers: {
		Date: dateScalar,

		RootQuery: {
			...Token.QueryResolvers,
			...User.QueryResolvers,
			...Auth.QueryResolvers,
			...Media.QueryResolvers,

			...Config.QueryResolvers,
			...Settings.QueryResolvers,

			...Template.QueryResolvers,
			...MailQueue.QueryResolvers,

			...Tenant.QueryResolvers,
		},

		RootMutation: {
			...Token.MutationResolvers,
			...User.MutationResolvers,
			...Auth.MutationResolvers,
			...Media.MutationResolvers,

			...Config.MutationResolvers,
			...Settings.MutationResolvers,

			...Template.MutationResolvers,
			...MailQueue.MutationResolvers,

			...Tenant.MutationResolvers,
		},

		...Token.Resolvers,
		...User.Resolvers,
		...Auth.Resolvers,
		...Media.Resolvers,

		...Config.Resolvers,
		...Settings.Resolvers,

		...Template.Resolvers,
		...MailQueue.Resolvers,

		...Tenant.Resolvers,
	},
}))

const server = new ApolloServer({
	schema,

	csrfPrevention: true,

	plugins: [
		authPlugin
	],

	cache: new InMemoryLRUCache(),
})

//>

export async function boot(app){
	await server.start()

	if(debugGraphQL) debug(app)

	app.use(
		'/graphql',
		cors((req, callback) => {
			callback(null, {
				credentials: true,
				origin: req.get('origin')
			})
		}),
		express.json(),
		expressMiddleware(server, {
			context: ({req, res}) => {
				return {
					isDev: process.env.NODE_ENV === 'development',
					user: req.user || null,
					self: req.self || null,
					res,
				}
			},
		})
	)
}

export function graphqlExec(source, variables={}){
	return server.executeOperation({
		query: source,
		variables: variables
	})
}

export const gql = ApolloGQL
