// Inserts the mail templates the api relies on, only when they are missing.
// Usage: node -r dotenv/config scripts/seed-mail-templates.js
import mongoose from 'mongoose'

const docs = [
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

await mongoose.connect(process.env.MONGO)
const col = mongoose.connection.db.collection('template')
const now = new Date()

for(const doc of docs){
	const res = await col.updateOne(
		{slug: doc.slug},
		{$setOnInsert: {...doc, createdAt: now, updatedAt: now}},
		{upsert: true}
	)
	console.log(doc.slug, res.upsertedCount ? 'créé' : 'existait déjà')
}

console.table(await col.find({}, {projection: {slug: 1, title: 1, _id: 0}}).toArray())
await mongoose.disconnect()
