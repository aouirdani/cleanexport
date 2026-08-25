# CleanExport — plan d'acquisition

Document autonome. Tout ce dont tu as besoin est ici : où trouver les gens,
quoi leur écrire, quoi préparer, et quand arrêter.

---

## Ce que tu as déjà et que presque personne n'a

1. Un produit qui tourne en production sur ton domaine.
2. Un fichier `.xlsx` correct, produit depuis un vrai portail HubSpot.
3. Des acheteurs identifiables nominativement, qui ont décrit ton problème
   avec leurs propres mots, publiquement.

Le point 3 est ce qui rend ce plan possible. Tu ne prospectes pas dans le
vide — tu réponds à des gens qui se sont déjà plaints.

---

# LUNDI — construire la liste (2 heures)

## Où chercher, par ordre de qualité

### 1. Le forum d'idées HubSpot (source principale)

`community.hubspot.com` → onglet **Ideas** → recherche sur ces termes,
un par un :

```
export to excel
dashboard export
report export
scheduled report
csv export
export columns
```

Trie par nombre de votes. Les fils les plus votés ont le plus de
commentaires, donc le plus de prospects.

Ce que tu notes pour chaque personne :

| Champ | Où le trouver |
|---|---|
| Prénom | profil du commentateur |
| Poste | souvent dans la signature ou le profil |
| Entreprise | profil, ou via LinkedIn |
| **Sa phrase exacte** | son commentaire, copié mot pour mot |
| Lien du fil | pour pouvoir le citer |

**La phrase exacte est le cœur de ta prospection.** Sans elle, ton message
est du démarchage. Avec elle, c'est une réponse.

### 2. G2 et Capterra

`g2.com/products/hubspot-marketing-hub/reviews` — filtre sur 2 et 3
étoiles, cherche dans les avis les mots `report`, `export`, `excel`.

Les 1 étoile sont des gens énervés par le support. Les 2-3 étoiles sont
des clients fidèles qui décrivent précisément ce qui manque. Ce sont eux
qui achètent.

### 3. Reddit

```
site:reddit.com hubspot export excel
site:reddit.com r/hubspot report export
```

Moins de contexte professionnel, mais des descriptions de douleur très
concrètes.

### 4. Les agences partenaires HubSpot

`ecosystem.hubspot.com/marketplace/solutions` — filtre par pays.

Une agence gère 10 à 40 portails clients et se cogne au même mur sur
chacun. **Une agence signée vaut plusieurs clients.** Vise-en 5 sur tes 30.

## Trouver les adresses e-mail

Les formats d'entreprise sont prévisibles : `prenom.nom@`, `pnom@`,
`prenom@`.

Outils : **Hunter.io** (25 recherches gratuites par mois),
**Apollo.io** (crédits gratuits), ou simplement LinkedIn + déduction.

Si tu ne trouves pas l'e-mail : **réponds directement dans le fil du
forum**. C'est public, c'est légitime, et les autres lecteurs du fil te
voient aussi.

## Ton tableau de suivi

Un simple Google Sheet :

```
Prénom | Poste | Entreprise | Email | Source | Sa phrase | Envoyé le | Réponse | Payé
```

---

# MARDI — préparer les preuves (1 heure)

## 1. Les deux fichiers Excel

Exporte le même contact deux fois :

**Par HubSpot** : Contacts → sélectionne → Exporter → CSV. Choisis un
contact dont un champ texte long contient des sauts de ligne.

**Par CleanExport** : le même contact, les mêmes propriétés.

Ouvre les deux dans Excel, côte à côte, capture d'écran. À gauche le
contact éclaté sur plusieurs lignes ; à droite une seule ligne propre.

**C'est ton meilleur argument.** Il ne se discute pas.

## 2. Le lien de paiement Stripe

Stripe, mode **réel** → Paiements → Liens de paiement → Créer.

- Produit : CleanExport Solo
- Applique un coupon **50 % à vie** (crée-le dans Coupons : 50 %, durée
  « toujours »)
- Prix affiché : **14,50 $/mois**
- Limite : 5 utilisations

Note l'URL. C'est elle qui va dans tes messages.

## 3. Une page de remerciement

Après paiement, Stripe redirige. Mets `https://cleanexporter.com/dashboard`
en URL de redirection, ou une page simple qui dit quoi faire ensuite.

---

# MERCREDI ET JEUDI — envoyer (2 heures par jour)

Quinze messages par jour. **Un par un.** Jamais d'envoi groupé.

## Depuis quelle adresse

**Ton adresse habituelle** — Gmail, Outlook, celle que tu utilises tous les
jours. Pas `@cleanexporter.com`.

Raison : ton domaine a quelques jours, aucune réputation d'envoi. Un rebond
iCloud l'a déjà démontré. Du courrier froid depuis un domaine neuf part
directement en spam.

`cleanexporter.com` sert au transactionnel, où le destinataire attend le
message.

## Le message

Objet :

```
That HubSpot export thread — I built the thing
```

Corps :

```
Hi {Prénom},

You commented on the HubSpot Ideas thread about exporting reports to
Excel — you wrote: "{sa phrase exacte}".

I hit the same wall and got tired of waiting, so I built it.

CleanExport lets you rebuild the export once, then the .xlsx lands in
your inbox on whatever schedule you pick.

I've attached a file it generated from a real portal this morning, next
to what HubSpot's own CSV export does to the same records. HubSpot's
version splits one contact into four rows the moment a Notes field has
line breaks. Mine doesn't.

It's read-only — no write scope on your CRM at all.

I'm looking for the first five paying users. It's $29/month, or $14.50
locked for life if you're one of them. Fully refundable if I don't
deliver.

{lien de paiement}

Worth a look?

Aymane
```

**Pièces jointes** : le `.xlsx` de CleanExport, et la capture comparative.

## Ce qui fait échouer un message

- Pas de phrase citée → c'est du démarchage
- Une question au lieu d'un lien → « est-ce que tu paierais ? » ne coûte
  rien à répondre oui
- Plus de 200 mots → personne ne lit
- Une pièce jointe manquante → tu perds ton seul argument irréfutable

---

# VENDREDI — relancer (1 heure)

**Une seule** relance, à ceux qui n'ont pas répondu. Deux lignes, pas un
nouveau pitch :

```
Hi {Prénom},

Quick follow-up — is the HubSpot export problem still costing you time?
If so I'll show you in five minutes.

If not, no worries, I'll leave you alone.

Aymane
```

Les relances convertissent souvent mieux que le premier envoi. Les gens
n'ignorent pas, ils oublient.

---

# LES CRITÈRES D'ARRÊT

Décidés maintenant, avant d'être attaché au résultat.

| Résultat sur 30 messages | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Moins de 5 réponses | Le message ou la cible sont mauvais | Change de source, refais 30 |
| 5+ réponses, 0 paiement | La douleur existe mais ne vaut pas d'argent | Arrête. C'est une information, pas un échec. |
| 1 ou 2 paiements | Signal faible mais réel | Refais 30 messages avant de conclure |
| **3+ paiements** | **Tu as un business** | Construis la suite |

Attends-toi à **3 à 6 réponses sur 30**. C'est le taux normal du courrier
froid, pas un échec.

Trois personnes qui sortent leur carte pour un produit qu'elles n'ont pas
encore utilisé valent mille fois trente qui disent « super idée ».

---

# APRÈS — le contenu (seulement si tu as 3 paiements)

N'écris pas de contenu avant d'avoir des clients. Tu publierais ce que tu
crois convaincant. Avec trois clients, tu sauras quelle phrase les a
décidés — ça vaut dix articles.

## LinkedIn — ton meilleur canal

Tes acheteurs sont marketing ops et RevOps, ils vivent là.

Ce que tu peux écrire et que **personne d'autre ne peut** : les découvertes
de ta reconnaissance API.

- 70 propriétés HubSpot sont `datetime` mais affichées comme des dates —
  se caler sur `fieldType` supprime l'heure en silence
- Excel garde 15 chiffres significatifs : un ID de 16 chiffres stocké
  comme nombre devient un **autre** ID
- `hubspot_owner_id` est déclaré comme énumération avec un tableau
  d'options vide — d'où les `96879917` dans les colonnes propriétaire
- Les lectures batch d'associations renvoient un HTTP 207, pas 200, et
  `results` n'est pas aligné sur `inputs`

Publie ça comme du savoir utile, pas comme de la promotion. Deux
publications par semaine suffisent.

## Reddit — utile mais lent

**Ne poste pas ton produit sans historique** : tu seras banni de `r/hubspot`
et tu perdras la communauté la plus dense en prospects qualifiés.

La méthode qui marche : deux semaines à **répondre** aux questions sur
l'export et le reporting, sans mentionner ton produit. Puis, quand
quelqu'un décrit exactement ton problème, tu réponds avec la solution et
tu mentionnes que tu l'as construite.

Variante acceptée : un post « j'ai construit ça parce que HubSpot cassait
mes exports », avec les captures comparatives, en admettant que tu vends.
Les subreddits techniques tolèrent ça quand c'est direct.

## Le HubSpot App Marketplace

**Rappel important** : ton app est plafonnée à **25 installations** tant
qu'elle n'est pas référencée.

C'est suffisant pour tes premiers clients, mais lance la soumission vers
10 clients payants — la revue prend du temps, et tu ne veux pas atteindre
le plafond avant l'approbation.

Le référencement est aussi un canal d'acquisition en soi.

## Ce qu'il ne faut pas faire

- **La publicité payante.** Tu ne sais pas encore quel message convertit.
  Tu paierais pour apprendre ce que 30 e-mails gratuits t'apprennent.
- **Les vidéos avant les clients.** Tu filmerais ce que tu crois
  convaincant.
- **Un domaine neuf pour du courrier froid.** Spam garanti.

---

# LE RÉSUMÉ EN UNE PAGE

**Lundi** : 30 noms, avec leur phrase exacte.
**Mardi** : deux captures Excel, un lien de paiement à 14,50 $.
**Mercredi** : 15 messages, depuis ton adresse habituelle.
**Jeudi** : 15 messages.
**Vendredi** : une relance.

Trois paiements, ou tu arrêtes.

Le produit est fini. Il ne reste que ça.
