import {canAccessTenant, genFailedMutation, isAdmin, isService, unauthorized} from './_helper.js'
import * as importApi from '../import/import.js'
import * as tenantApi from '../tenant/tenant.js'

// Admins see every source, a manager the source of a tenant he works on
// (read only: the mutations are for admins)
function checkTenant(context, _tenant){
	const allowed = !isService(context) && (_tenant ? canAccessTenant(context, _tenant) : isAdmin(context))
	if(!allowed) unauthorized()
}

async function checkSource(context, source){
	if(isAdmin(context)) return

	const tenant = await tenantApi.getByImportSource(source)
	if(!tenant) unauthorized()

	checkTenant(context, tenant._id.toString())
}

// --

const ImportSource = `
  type ImportSource {
    key: String
    label: String
    configured: Boolean
    _tenant: String
    tenant: Tenant

    paused: Boolean
    counts: ImportCounts
    workers: Int
    lastRun: ImportRun
  }
`

const ImportCounts = `
  type ImportCounts {
    waiting: Int
    active: Int
    delayed: Int
    failed: Int
  }
`

const ImportRun = `
  type ImportRun {
    _id: String
    source: String
    status: String

    startedAt: Date
    listedAt: Date
    finishedAt: Date

    total: Int
    created: Int
    updated: Int
    unchanged: Int
    failed: Int
    gone: Int

    error: String
  }
`

const ImportJob = `
  type ImportJob {
    id: String
    name: String
    data: JSONObject
    ref: String
    failedReason: String
    stacktrace: [String]
    attemptsMade: Int
    createdAt: Date
    failedAt: Date
  }
`

const ImportJobs = `
  type ImportJobs {
    total: Int
    data: [ImportJob]
  }
`

const ImportMutation = `
  type ImportMutation {
    success: Boolean
    message: String
    stack: [String]
    run: ImportRun
    retried: Int
  }
`

// Every action answers the same way, an error becomes success: false
async function mutation(context, fn){
	try {
		return {success: true, ...await fn()}
	} catch(err) {
		return genFailedMutation(err, context)
	}
}

// --

export default {
	TypeDefs: [
		ImportSource,
		ImportCounts,
		ImportRun,
		ImportJob,
		ImportJobs,
		ImportMutation
	],

	//--

	Query: `
    importSources(_tenant: String): [ImportSource]
    importRuns(source: String! limit: Int): [ImportRun]
    importFailedJobs(source: String! limit: Int skip: Int): ImportJobs
	`,

	QueryResolvers: {
		// Every source, with its tenant (Tenant.importSource), its queue and its
		// last run. _tenant: only the source of this tenant.
		importSources: async (obj, {_tenant}, context) => {
			checkTenant(context, _tenant)

			const sources = await importApi.getSources()
			return _tenant ? sources.filter(s => s.tenant?._id?.toString() === _tenant) : sources
		},

		importRuns: async (obj, {source, limit}, context) => {
			await checkSource(context, source)
			return importApi.getRuns(source, limit || 20)
		},

		// The stack traces stay for the admins
		importFailedJobs: async (obj, {source, limit, skip}, context) => {
			await checkSource(context, source)

			const jobs = await importApi.getFailedJobs(source, {limit: limit || 50, skip: skip || 0})
			if(!isAdmin(context)) jobs.data.forEach(job => job.stacktrace = [])

			return jobs
		},
	},

	//--

	Resolvers: {
		ImportSource: {
			_tenant: obj => obj.tenant?._id?.toString() || null,
		}
	},

	//--

	Mutation: `
		importStart(source: String!): ImportMutation @admin
		importPause(source: String!): ImportMutation @admin
		importResume(source: String!): ImportMutation @admin
		importStop(source: String!): ImportMutation @admin
		importReset(source: String!): ImportMutation @admin
		importRetry(source: String! jobId: String): ImportMutation @admin
	`,

	MutationResolvers: {
		importStart: (obj, {source}, context) => mutation(context, async () => ({run: await importApi.start(source)})),
		importPause: (obj, {source}, context) => mutation(context, () => importApi.pause(source)),
		importResume: (obj, {source}, context) => mutation(context, () => importApi.resume(source)),
		importStop: (obj, {source}, context) => mutation(context, () => importApi.stop(source)),
		importReset: (obj, {source}, context) => mutation(context, () => importApi.reset(source)),
		importRetry: (obj, {source, jobId}, context) => mutation(context, async () => ({retried: await importApi.retry(source, jobId)})),
	},
}
