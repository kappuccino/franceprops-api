import {canAccessTenant, genFailedMutation, isAdmin, unauthorized} from './_helper.js'
import * as mailQueueApi from '../mail-queue/mail-queue.js'
import * as tenantApi from '../tenant/tenant.js'

// Admins see every mail, a manager the mails of a tenant he works on (_tenant)
function checkTenant(context, _tenant){
	const allowed = _tenant ? canAccessTenant(context, _tenant) : isAdmin(context)
	if(!allowed) unauthorized()
}

// --

const MailQueue = `
  type MailQueue {
    _id: String
    createdAt: Date
    id: String
    tag: String
    _tenants: [String]
    tenants: [Tenant]
    status: String
    error: String
    raw: JSONObject
    events: [MailQueueEvent]
    resentAt: Date
  }
`

const MailQueueEvent = `
  type MailQueueEvent {
    occurredAt: Date
    type: String
    email: String
    error: String
    hardBounce: Boolean
  }
`

const MailQueueAttachment = `
  type MailQueueAttachment {
    filename: String
    contentType: String
    content: String
  }
`

const MailQueueAggregate = `
  type MailQueueAggregate {
    total: Int
    limit: Int
    skip: Int
    data: [MailQueue]
  }
`

const MailQueueAggregateParams = `
	input MailQueueAggregateParams {
    limit: Int
    skip: Int
    sort: JSONObject
    status: [String]
    errors: Boolean
    tag: [String]
    search: String
    _tenant: String
  }
`

// --

export default {
	TypeDefs: [
		MailQueue,
		MailQueueEvent,
		MailQueueAttachment,
		MailQueueAggregate,
		MailQueueAggregateParams
	],

	//--

	Query: `
    aggregateMailQueue(params: MailQueueAggregateParams): MailQueueAggregate
    getMailQueueTags(_tenant: String): [String]
    getMailQueueAttachment(_id: String! index: Int!): MailQueueAttachment
	`,

	QueryResolvers: {
		aggregateMailQueue: (obj, {params={}}, context) => {
			checkTenant(context, params._tenant)
			return mailQueueApi.aggregate(params)
		},

		getMailQueueTags: (obj, {_tenant}, context) => {
			checkTenant(context, _tenant)
			return mailQueueApi.getTags({_tenant})
		},

		// A manager reaches the attachments of the mails of his tenants only
		getMailQueueAttachment: async (obj, {_id, index}, context) => {
			const mail = await mailQueueApi.getById(_id)
			if(!mail) throw new Error('mail not found')

			const allowed = isAdmin(context) || (mail._tenants || []).some(t => canAccessTenant(context, t.toString()))
			if(!allowed) unauthorized()

			return mailQueueApi.getAttachment(_id, index)
		}
	},

	//--

	Resolvers: {
		MailQueue: {
			tenants: obj => tenantApi.getByIds(obj._tenants),
		}
	},

	//--

	Mutation: `
		resendMailQueue(_id: String!): GenericMutation @admin
		removeMailQueue(_id: String!): GenericMutation @admin
	`,

	MutationResolvers: {
		resendMailQueue: async (obj, {_id}, context) => {
			try {
				const success = await mailQueueApi.resend(_id)
				return {success, message: success ? null : 'Mail not sent'}
			} catch(err){
				return genFailedMutation(err, context)
			}
		},

		removeMailQueue: async (obj, {_id}, context) => {
			try {
				const success = await mailQueueApi.remove(_id)
				return {success}
			} catch(err){
				return genFailedMutation(err, context)
			}
		}
	}
}
