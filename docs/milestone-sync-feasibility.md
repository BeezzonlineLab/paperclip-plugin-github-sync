# Faisabilité — Synchronisation des Milestones GitHub vers Paperclip

> Analyse technique. Aucune fonctionnalité n'est implémentée dans ce document : il
> sert à décider *si* et *comment* synchroniser les milestones GitHub avant d'écrire
> du code.

## 1. Résumé (TL;DR)

| Question | Réponse |
|----------|---------|
| Récupérer les milestones depuis GitHub ? | ✅ **Faisable** — l'API et l'infra du plugin sont prêtes |
| Les afficher dans Paperclip (lecture seule) ? | ✅ **Faisable dès maintenant** via `plugin.state` + UI existante |
| En faire une **entité Paperclip de premier ordre** (comme un projet/epic) ? | ⚠️ **Bloqué** — le SDK Paperclip n'expose ni entité « milestone », ni `projects.create`, ni champ de regroupement sur les issues |
| Sync **sortant** (Paperclip → milestone GitHub) ? | ⚠️ **Partiel** — dépend de l'existence d'un concept source côté Paperclip |

**Verdict :** une synchronisation **entrante en lecture seule** (métadonnées de
milestone rattachées aux issues, affichées dans l'onglet GitHub) est réalisable
immédiatement avec un effort faible. Une synchronisation **bidirectionnelle « vraie »**
(le milestone devient un objet Paperclip manipulable) est aujourd'hui **limitée par
le SDK Paperclip**, pas par GitHub.

---

## 2. Ce qu'est un milestone GitHub

Un milestone est un objet **rattaché à un dépôt** qui regroupe des issues/PR. Champs :

- `number`, `title`, `description`
- `state` : `open` | `closed`
- `due_on` (échéance), `created_at`, `updated_at`, `closed_at`
- `open_issues`, `closed_issues` (progression)
- `creator`

Points structurants :

1. **Chaque issue porte déjà son milestone** dans le payload (`issue.milestone`) — donc
   aucun appel supplémentaire n'est nécessaire pour connaître le milestone d'une issue.
2. GitHub émet un **événement webhook `milestone`** (`created`, `edited`, `closed`,
   `opened`, `deleted`) en plus des événements `issues` déjà gérés.
3. Endpoints REST : `GET /repos/{owner}/{repo}/milestones`, `POST` (création),
   `PATCH /repos/{owner}/{repo}/issues/{number}` avec `{ "milestone": <number> }`
   pour assigner un milestone à une issue.

---

## 3. Côté GitHub : entièrement faisable

Le plugin possède déjà toute l'infrastructure nécessaire ; il faut juste l'étendre.

| Besoin | État actuel | Modification |
|--------|-------------|--------------|
| Auth GitHub App + token | ✅ `src/github/auth.ts` | aucune |
| Client HTTP + retry + rate limit | ✅ `src/github/client.ts` | ajouter `listMilestones()` / `getMilestone()` / `setIssueMilestone()` |
| Type `milestone` sur l'issue | ❌ absent de `GitHubIssue` | ajouter le champ `milestone` (déjà présent dans le payload GitHub) |
| Webhook | ✅ `issues` + `pull_request` | s'abonner à l'événement `milestone` et le router dans `onWebhook` |
| Polling | ✅ `src/sync/poll.ts` | lister les milestones par repo dans le cycle |
| Anti-boucle (nonce) | ✅ `src/sync/dedup.ts` | réutilisable tel quel pour les écritures sortantes |

**Conclusion partielle :** rien ne bloque côté GitHub. C'est du code additif qui suit
les patterns déjà en place.

---

## 4. Côté Paperclip : le vrai point de blocage

La surface du SDK réellement disponible (relevée dans le code) est :

```
ctx.projects.list         (lecture seule — PAS de create)
ctx.issues.create/get/update   (champs: title, description, status, assigneeAgentId, projectId)
ctx.agents.list/get
ctx.state.get/set/delete  (stockage clé/valeur du plugin)
ctx.http / ctx.events / ctx.jobs / ctx.data / ctx.actions / ctx.secrets
```

**Il n'existe :**

- ❌ aucune entité « milestone » / « epic » / « sprint » dans Paperclip ;
- ❌ aucun `ctx.projects.create` (déjà documenté comme limite du SDK) ;
- ❌ aucun champ visible de **regroupement/étiquette** sur l'issue (`labels`, `tags`,
   `milestoneId`, `parentId`) dans les appels `issues.create/update` utilisés.

C'est le cœur du problème : **à quoi mapper un milestone dans Paperclip ?**

### Stratégie A — Milestone → Projet Paperclip
- **Conflit** : un repo = un projet est déjà la règle de mapping (`poll.ts`,
  matching par nom). Un repo contient *plusieurs* milestones → collision de modèle.
- `projects.create` indisponible → les projets doivent être créés à la main de toute façon.
- ❌ Non viable comme modèle principal sans redéfinir tout le mapping repo→projet.

### Stratégie B — Milestone → métadonnée/regroupement d'issue
- **Le mapping le plus naturel** : un milestone regroupe des issues, comme un projet
  Paperclip regroupe des issues.
- **Faisable UNIQUEMENT si** le modèle d'issue Paperclip expose un champ exploitable
  (label, tag, champ personnalisé, parent). **À VÉRIFIER** contre les types réels de
  `@paperclipai/plugin-sdk` (non installés dans ce repo — voir §7).
- À défaut, on ne peut qu'**injecter le nom du milestone dans la `description`**
  (texte libre) → lossy, non filtrable, fragile. ⚠️ Solution de repli médiocre.

### Stratégie C — Métadonnées en lecture seule (état plugin + UI) ✅ RECOMMANDÉE en MVP
- Stocker dans `ctx.state` :
  - `milestone:<repo>#<number>` → `{ title, state, due_on, open, closed }`
  - `issue:<githubRef>:milestone` → `<repo>#<number>`
- Afficher dans l'`IssueDetailTab` existant (titre, échéance, progression, lien) et
  un compteur dans le dashboard.
- ✅ **Réalisable immédiatement**, aucune dépendance à une évolution du SDK, aucun
  risque sur le modèle de données Paperclip.
- ➖ Le milestone n'est pas « manipulable » dans Paperclip (pas de filtre/regroupement
  natif), c'est de l'enrichissement d'affichage.

---

## 5. Direction de synchronisation

| Direction | Faisabilité | Notes |
|-----------|-------------|-------|
| **Entrant** GitHub → Paperclip (affichage) | ✅ Immédiat | Stratégie C |
| **Entrant** GitHub → Paperclip (entité réelle) | ⚠️ Dépend du SDK | Stratégie B |
| **Sortant** Paperclip → GitHub | ⚠️ Nécessite une source | Il faut un concept côté Paperclip (ou une action UI « assigner à un milestone ») pour originer l'écriture. Techniquement l'écriture GitHub est triviale (`PATCH issue`), mais il n'y a rien à synchroniser tant que Paperclip n'a pas de milestone. |

---

## 6. Plan de mise en œuvre recommandé (par phases)

**Phase 1 — MVP lecture seule (faisable maintenant, effort faible : ~0,5–1 j)**
1. Ajouter `milestone` au type `GitHubIssue`.
2. `GitHubClient.listMilestones(repo)` + capter `issue.milestone` déjà présent.
3. Persister les milestones et le lien issue→milestone dans `ctx.state`.
4. S'abonner au webhook `milestone` + intégrer au cycle de polling.
5. Étendre `issue-github-info` (data endpoint) et l'`IssueDetailTab` pour afficher
   milestone + échéance + progression. Ajouter un compteur au dashboard.

**Phase 2 — Regroupement réel (bloqué tant que le SDK n'est pas confirmé/étendu)**
- Vérifier si le modèle d'issue Paperclip accepte un champ de regroupement (§7).
- Si oui : écrire l'appartenance au milestone sur l'issue pour filtre/tri natifs.
- Si non : demander à l'équipe Paperclip core une capacité (`milestones.*` ou
  `issues.labels` / champ custom). C'est une dépendance externe au plugin.

**Phase 3 — Sortant (optionnel)**
- Action UI « Assigner cette issue à un milestone GitHub » / « Créer un milestone ».
- Réutiliser le mécanisme de nonce anti-boucle existant pour les écritures.

---

## 7. Inconnue à lever avant Phase 2

Les dépendances (`@paperclipai/plugin-sdk`, `@paperclipai/shared`) **ne sont pas
installées** dans ce dépôt ; impossible d'inspecter les types réels d'`Issue`.

**Action requise :** confirmer, contre les `.d.ts` du SDK, si `issues.create/update`
accepte un champ de regroupement (labels/tags/parent/custom fields). Cette réponse
détermine si la Stratégie B est possible sans évolution du SDK.

---

## 8. Risques & limites

- **Modèle de données** : sans entité milestone côté Paperclip, la sync reste de
  l'enrichissement d'affichage (Phase 1), pas une vraie synchro d'objets.
- **Progression** : `open_issues`/`closed_issues` de GitHub peut diverger de l'état
  Paperclip (issues fermées manuellement, issues non importées) → afficher la source
  GitHub comme référence, ne pas tenter de recalculer.
- **Rate limit** : lister les milestones par repo ajoute des appels ; réutiliser le
  garde-fou `isRateLimitSafe()` existant.
- **Multi-tenant** : inchangé (une org GitHub par instance).
