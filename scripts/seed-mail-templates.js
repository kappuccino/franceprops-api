// Inserts the mail templates the api relies on, only when they are missing.
// Usage: node -r dotenv/config scripts/seed-mail-templates.js
import mongoose from 'mongoose'

const docs = [
	{
		slug: 'request-tenant-revised',
		name: 'Loueur - Demande de devis modifiée',
		title: 'Demande de devis modifiée',
		content: 'Bonjour,\n\n*|CUSTOMER|* a modifié sa demande de devis, votre partie est à chiffrer de nouveau.\n\n'
			+ 'Projet : *|PROJECT|*\nLocation *|DATES|*\n*|DELIVERY|*\n\n'
			+ '*|CHANGES|*\n\n'
			+ 'Produits de la nouvelle demande (*|COUNT|*) :\n*|PRODUCTS|*\n\n'
			+ 'Déposez votre devis (PDF) ou indiquez que vous ne pouvez pas y répondre :\n*|LINK|*'
	},
	{
		slug: 'request-tenant-cancelled',
		name: 'Loueur - Devis plus nécessaire',
		title: 'Votre devis n\'est plus nécessaire',
		content: 'Bonjour,\n\n*|CUSTOMER|* a modifié sa demande de devis et ne demande plus les produits suivants :\n*|PRODUCTS|*\n\n'
			+ "Votre devis pour cette demande n'est plus nécessaire.\n*|LINK|*"
	},
	{
		slug: 'request-tenant-new',
		name: 'Loueur - Nouvelle demande de devis',
		title: 'Nouvelle demande de devis',
		content: 'Bonjour,\n\nUne demande de devis de *|CUSTOMER|* attend votre chiffrage : *|COUNT|* produit(s).\n\n'
			+ 'Projet : *|PROJECT|*\nLocation *|DATES|*\n*|DELIVERY|*\n\n'
			+ '*|PRODUCTS|*\n\n'
			+ 'Déposez votre devis (PDF) ou indiquez que vous ne pouvez pas y répondre :\n*|LINK|*'
	},
	{
		slug: 'request-tenant-accepted',
		name: 'Loueur - Devis accepté',
		title: 'Votre devis a été accepté',
		content: 'Bonjour,\n\n*|CUSTOMER|* a accepté votre devis de *|AMOUNT|* HT (demande n° *|NUMBER|*, projet *|PROJECT|*).\n\n'
			+ 'Retrouvez la demande ici :\n*|LINK|*'
	},
	{
		slug: 'request-tenant-refused',
		name: 'Loueur - Devis refusé',
		title: "Votre devis n'a pas été retenu",
		content: "Bonjour,\n\n*|CUSTOMER|* n'a pas donné suite à votre devis de *|AMOUNT|* HT (demande n° *|NUMBER|*, projet *|PROJECT|*).\n\n"
			+ 'Retrouvez la demande ici :\n*|LINK|*'
	},
	{
		slug: 'request-customer-answered',
		name: 'Client - Devis disponible',
		title: 'Votre devis est disponible',
		content: 'Bonjour,\n\nTous les loueurs ont répondu à votre demande de devis.\n\n'
			+ 'Retrouvez leurs devis ici :\n*|LINK|*'
	},
	{
		slug: 'customer-email-code',
		name: 'Client - Code de changement d\'email',
		title: 'Confirmez votre nouvelle adresse',
		content: 'Bonjour,\n\nVoici votre code pour confirmer cette nouvelle adresse : *|CODE|*\n'
			+ 'Il est valable 15 minutes.\n\n'
			+ "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
	},
	{
		slug: 'customer-email-changed',
		name: 'Client - Email modifié',
		title: 'Votre adresse email a été modifiée',
		content: 'Bonjour,\n\nL\'adresse email de votre compte a été remplacée par *|EMAIL|*.\n\n'
			+ "Si vous n'êtes pas à l'origine de ce changement, contactez-nous rapidement."
	},
	{
		slug: 'customer-password-code',
		name: 'Client - Code de mot de passe perdu',
		title: 'Réinitialisez votre mot de passe',
		content: 'Bonjour,\n\nVoici votre code pour choisir un nouveau mot de passe : *|CODE|*\n'
			+ 'Il est valable 15 minutes.\n\n'
			+ "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé."
	},
	{
		slug: 'customer-signup-code',
		name: 'Client - Code de création de compte',
		title: 'Votre code de confirmation',
		content: 'Bonjour,\n\nVoici votre code pour créer votre compte : *|CODE|*\n'
			+ 'Il est valable 15 minutes.\n\n'
			+ "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
	},
	{
		slug: 'user-reset-password',
		name: 'Utilisateur - Nouveau mot de passe',
		title: 'Nouveau mot de passe',
		content: 'Bonjour,\nVoici le lien pour changer votre mot de passe :\n*|LINK|*'
	},
	{
		slug: 'user-magic-link',
		name: 'Utilisateur - Lien de connexion',
		title: 'Lien de connexion',
		content: 'Bonjour,\n\nVoici le lien pour vous connecter :\n'
			+ 'Ce lien est valide pour 60 minutes et une seule utilisation.\n'
			+ "Ne partagez pas ce lien, il permet à n'importe qui de se connecter en tant que vous.\n\n*|LINK|*"
	}
]

// --force=slug,slug: overwrites the title and content of these templates
// (otherwise an existing template, maybe edited in the dashboard, is kept)
const force = (process.argv.find(arg => arg.startsWith('--force='))?.slice(8) || '').split(',').filter(Boolean)

await mongoose.connect(process.env.MONGO)
const col = mongoose.connection.db.collection('template')
const now = new Date()

for(const doc of docs){
	if(force.includes(doc.slug)){
		await col.updateOne({slug: doc.slug}, {$set: {title: doc.title, content: doc.content, updatedAt: now}})
		console.log(doc.slug, 'écrasé (--force)')
		continue
	}

	const res = await col.updateOne(
		{slug: doc.slug},
		{$setOnInsert: {...doc, createdAt: now, updatedAt: now}},
		{upsert: true}
	)
	console.log(doc.slug, res.upsertedCount ? 'créé' : 'existait déjà')
}

console.table(await col.find({}, {projection: {slug: 1, title: 1, _id: 0}}).toArray())
await mongoose.disconnect()
