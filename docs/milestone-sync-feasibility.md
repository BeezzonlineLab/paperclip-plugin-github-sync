# Faisabilité — Synchronisation des Milestones GitHub vers Paperclip

> Analyse technique. Aucune fonctionnalité n'est implémentée dans ce document : il
> sert à décider *si* et *comment* synchroniser les milestones GitHub avant d'écrire
> du code.

## 1. Résumé (TL;DR)

| Question | Réponse |
|----------|---------|
| Récupérer les milestones depuis GitHub ? | ✅ **Faisable** — l'API et l'infra du plugin sont prêtes |
| Les afficher dans Paperclip (lecture seule) ? | ✅ **Faisable dès maintenant** via `plugin.state` + UI existante |
| En faire un **regroupement Paperclip natif** (tâche parente / enfants) ? | ✅ **Faisable** — `issues.create` accepte `parentId` (vérifié dans le SDK). Contrainte : lien figé à la création (pas de re-parent via `update`) |
| Sync **sortant** (Paperclip → milestone GitHub) ? | ⚠️ **Partiel** — dépend de l'existence d'un concept source côté Paperclip |

**Verdict :** réalisable. **Approche retenue : Milestone → Goal Paperclip** (`ctx.goals`),
plus propre car le milestone n'apparaît pas comme une fausse tâche. Faisable et confirmé
dans le SDK, **à condition d'assumer** ces limitations (détail §4, Stratégie B-bis) :

- Le lien **issue→goal est figé à la création** (`issues.update` n'accepte pas `goalId`)
  → un changement de milestone sur GitHub ne se propage pas ; lien capté à l'import.
- Les Goals sont **au niveau company**, pas repo/projet → désambiguïsation par le titre
  + mapping en `state` ; et le plugin **ne peut pas** rattacher le goal au projet du repo.
- **Nouvelles capabilities** `goals.read`/`create`/`update` à déclarer ; pas de `delete`
  (milestone supprimé → goal `cancelled`) ; échéance/progression stockées en texte.

Alternative si ces limites gênent : **tâche parente/enfants** (`parentId`), rattachée au
projet du repo mais qui crée une issue « fantôme » et partage la même contrainte de
lien-à-la-création (§4, Stratégie B).

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

### Stratégie B — Milestone → tâche parente / issues enfants ✅ CONFIRMÉE FAISABLE
- **Le mapping le plus naturel** : un milestone regroupe des issues, exactement comme
  une **tâche parente Paperclip** regroupe des tâches enfants.
- **Vérifié** contre les types réels du SDK (`@paperclipai/plugin-sdk` v2026.x) :
  - `Issue` possède `parentId: string | null` et `ancestors[]` (hiérarchie native).
  - `ctx.issues.create({ ..., parentId })` **accepte `parentId`** → on peut créer une
    issue enfant sous une issue parente. ✅
  - `ctx.issues.getSubtree(id)` permet de lire l'arbre (parent + descendants). ✅
- **Modèle proposé :**
  1. Chaque **milestone GitHub** → une **issue parente** Paperclip (dans le projet du
     repo), non assignée à un agent, statut reflétant open/closed du milestone.
  2. Chaque **issue GitHub rattachée au milestone** → issue **enfant** créée avec
     `parentId` = l'id de l'issue parente milestone.
  3. Mapping stocké dans `ctx.state` : `milestone:<repo>#<number>` → `<parentIssueId>`.

- ⚠️ **CONTRAINTE FORTE (structurante) :** `parentId` n'est réglable **qu'à la création**
  (`issues.create`). **`issues.update` n'expose PAS `parentId`** → il est **impossible
  de re-parenter** une issue déjà importée via l'API du plugin. Conséquences :
  - Il faut créer/retrouver l'issue parente milestone **avant** de créer ses enfants
    (traiter les milestones avant les issues dans le cycle de sync).
  - Une issue importée **sans** milestone, puis ajoutée à un milestone plus tard sur
    GitHub, **ne pourra pas** être rattachée après coup. De même, un **changement de
    milestone** sur GitHub ne peut pas être répercuté sur l'issue Paperclip existante
    (pas de re-parent, pas de delete). → Le lien milestone est **capté au moment de
    l'import**, pas mis à jour ensuite. À documenter comme limite fonctionnelle.
  - L'issue parente « milestone » doit être **exclue** du flux sortant existant
    (`handleIssueUpdated`) pour ne pas déclencher labels de statut / création de PR.

### Stratégie B-bis — Milestone → Goal Paperclip (retenue : plus propre, mais limitations à assumer)

Le SDK expose les **Goals** (`ctx.goals` : `list/get/create/update`), un conteneur
hiérarchique. `issues.create` accepte `goalId`. Le milestone n'apparaît **pas** comme
une fausse « tâche » dans l'arbre → conceptuellement plus propre que la Stratégie B.

**Types réels (vérifiés) :**
```
Goal { id, companyId, title, description, level, status, parentId, ownerAgentId, createdAt, updatedAt }
GoalLevel  = "company" | "team" | "agent" | "task"
GoalStatus = "planned" | "active" | "achieved" | "cancelled"
PluginGoalsClient = { list, get, create({...,parentId?}), update(patch incl. parentId) }   // PAS de delete
ctx.issues.create({ ..., goalId? })   // goalId posé à la création
```

**Points favorables :**
- `goal` est un `entityType` valide de `detailTab` → onglet « GitHub » possible **sur la
  vue Goal elle-même** (les types UI autorisés : `project, issue, agent, goal, run, comment, …`).
- Goals re-parentables entre eux (`goals.update` accepte `parentId`) → on pourrait
  organiser les milestones en arborescence.
- N'encombre pas l'arbre de tâches avec des nœuds « faux ».

**Limitations (à assumer explicitement) :**

1. **Lien issue→goal figé à la création — LA limitation majeure (non résolue).**
   `issues.create` accepte `goalId`, mais **`issues.update` ne l'accepte PAS**. Donc,
   exactement comme la Stratégie B :
   - une issue importée **sans** milestone ne peut pas être rattachée à un goal après coup ;
   - un **changement/retrait de milestone** sur GitHub ne peut pas être répercuté sur
     l'issue Paperclip existante.
   Les Goals **ne corrigent pas** ce point. Le lien est capté **à l'import uniquement**.

2. **Goals = périmètre entreprise (company), pas repo/projet.**
   `Goal` n'a **pas de `projectId`**. Un milestone appartient à UN repo ; deux repos
   peuvent avoir « v1.0 ». Il faut désambiguïser dans le titre (`repo — v1.0`) et tenir
   le mapping dans `ctx.state`. Risque de collision/confusion entre repos.

3. **Impossible de rattacher le goal au projet du repo depuis le plugin.**
   Le modèle `Project` porte bien `goalIds`/`goals`, mais le client plugin `projects`
   est **lecture seule** (`list`/`get`). Le milestone-goal **flotte au niveau company**
   et n'apparaît pas « sous » le projet du repo → le bénéfice visuel de regroupement est
   plus faible qu'attendu.

4. **Taxonomie `level` inadaptée.** Aucun niveau (`company/team/agent/task`) ne
   correspond à « milestone » → choix arbitraire (bricolage sémantique).

5. **Vocabulaire de statut divergent et lossy.** Milestone = `open`/`closed` ;
   Goal = `planned|active|achieved|cancelled`. Le mapping est approximatif : `closed`
   ne distingue pas « atteint » d'« abandonné ».

6. **Pas de champ échéance ni de progression sur `Goal`.** `due_on` et les compteurs
   `open_issues`/`closed_issues` de GitHub n'ont aucun champ natif → doivent aller en
   texte libre dans `description` (non filtrable, non structuré).

7. **Pas de suppression (`goals` sans `delete`).** Un milestone supprimé sur GitHub ne
   peut qu'être passé en `status: "cancelled"` → accumulation de goals orphelins.

8. **Nouvelles capabilities requises** : `goals.read`, `goals.create`, `goals.update`
   (absentes du manifeste actuel) → l'admin doit les accorder (friction d'installation
   supérieure à la Stratégie B, qui réutilise les `issues.*` déjà déclarées).

9. **Risque de pollution d'une surface humaine.** Les Goals sont probablement une
   surface OKR partagée/visible par les humains ; injecter un goal par milestone GitHub
   peut noyer les vrais objectifs stratégiques sous des dizaines de « milestones ».

10. **Owner unique.** `Goal.ownerAgentId` est un propriétaire unique ; un milestone n'a
    pas d'owner → champ laissé vide (désalignement mineur).

**Comparaison synthétique :**

| Critère | B — Parent/enfant (issues) | B-bis — Goals |
|---------|----------------------------|---------------|
| Lien posé à la création uniquement (pas de re-parent) | ⚠️ Oui | ⚠️ Oui (identique) |
| Rattaché au repo/projet | ✅ Oui (issue dans le projet) | ❌ Non (company-scoped) |
| Pollue l'arbre de tâches | ⚠️ Oui (issue parente « fantôme ») | ✅ Non |
| Pollue une surface humaine (OKR) | ✅ Non | ⚠️ Oui (liste des goals) |
| Nouvelles capabilities | ✅ Aucune (`issues.*` déjà là) | ⚠️ `goals.*` à ajouter |
| Onglet UI dédié | issue | ✅ goal (dédié possible) |
| Échéance / progression natives | ❌ Non | ❌ Non |
| Suppression propre | ❌ Non (pas de delete d'issue) | ❌ Non (pas de delete de goal) |

**Décision retenue :** Goals (B-bis) pour la propreté conceptuelle, en **assumant**
les limitations 1 à 3 comme les plus structurantes : lien figé à la création,
périmètre company (désambiguïsation par le titre + mapping en état), et absence de
rattachement natif au projet du repo.

### Note sur les labels
- `issues.create/update` acceptent `labelIds`, et `issues.update` **peut** modifier les
  labels (donc modifiable après coup, contrairement au parent). **Mais** le SDK
  n'expose **aucune API pour créer/lister des labels** (`IssueLabel`) → il faudrait des
  labels pré-existants avec leurs IDs. Utile en complément, pas comme regroupement principal.

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

**Phase 2 — Regroupement via Goals (retenu, Stratégie B-bis)**
- Déclarer les capabilities `goals.read`, `goals.create`, `goals.update` au manifeste.
- Pour chaque milestone GitHub : `ctx.goals.create({ title: "<repo> — <milestone>",
  description: <échéance + progression + lien>, status: mappé depuis open/closed })`,
  ou retrouver le goal existant. Mapping `milestone:<repo>#<number>` → `<goalId>` en `state`.
- Traiter les milestones **avant** les issues dans le cycle (le goal doit exister avant).
- Créer les issues GitHub rattachées avec `goalId` = id du goal milestone.
- **Assumer/documenter** : `issues.update` n'accepte pas `goalId` → seul le **premier
  import** pose le lien ; un changement de milestone ultérieur ne se propage pas. La
  branche `update` de `processGitHubIssue` ne peut pas (re)poser le goal.
- Milestone supprimé → `goals.update(status: "cancelled")` (pas de delete).
- Surfacer via un `detailTab` sur l'entité `goal` (échéance, progression, lien GitHub).

**Phase 3 — Sortant (optionnel)**
- Action UI « Assigner cette issue à un milestone GitHub » / « Créer un milestone ».
- Réutiliser le mécanisme de nonce anti-boucle existant pour les écritures.

---

## 7. Vérification SDK (levée)

Inconnue résolue en installant `@paperclipai/plugin-sdk` (v2026.x) et en lisant les
types réels. Faits confirmés :

- `Issue.parentId: string | null` + `Issue.ancestors[]` → hiérarchie parent/enfant native.
- `ctx.issues.create({ ..., parentId?, goalId?, labelIds? })` → **le parent se pose à la création**.
- `ctx.issues.update(...)` = `Partial<Pick<Issue, "title"|"description"|"status"|"priority"|
  "assigneeAgentId"|"assigneeUserId"|"billingCode"|... >> & { blockedByIssueIds?, labelIds?, ... }`
  → **PAS de `parentId` ni `goalId`** ⇒ **re-parentage impossible** après création.
- `ctx.issues.getSubtree(id)` → lecture de l'arbre (réconciliation / UI).
- `ctx.goals` (`create/get/update`) existe ; `goals.update` accepte `parentId` (goals
  re-parentables) → alternative « conteneur » (Stratégie B-bis).
- **Pas** de `ctx.projects.create`, **pas** d'API de création de labels.

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
