# IR Cumulatif — Spécification du calcul

## 1. Objectif

Le moteur doit calculer l'**Impôt sur le Revenu (IR)** de manière **cumulative**.

Le SNI (**Salaire Net Imposable**) peut être différent chaque mois.

Le calcul du mois courant doit tenir compte :

* du SNI du mois courant ;
* des SNI des mois précédents ;
* du nombre de mois écoulés ;
* de la grille annuelle de l'IR ;
* de l'IR déjà retenu pendant les mois précédents.

Le système ne doit **jamais supposer que le SNI mensuel est constant**.

---

# 2. Principe général

Pour chaque mois, le moteur suit cette logique :

```text
SNI du mois courant
        +
SNI des mois précédents
        ↓
SNI cumulé
        ↓
Annualisation
        ↓
IR annuel théorique
        ↓
IR déjà retenu
        ↓
IR à retenir ce mois
```

La formule fondamentale est :

```text
IR à retenir ce mois
=
IR cumulé dû
-
IR déjà retenu
```

---

# 3. Première chose à comprendre — Le premier mois de paie

Le **premier mois de paie d'un salarié** ne signifie pas forcément janvier.

Il faut distinguer deux notions :

```text
Mois calendaire
=
position du mois dans l'année

Premier mois de paie
=
premier mois pour lequel le salarié possède une paie
```

Exemples :

```text
Salarié commencé en janvier
→ premier mois de paie = janvier
→ mois calendaire = 1

Salarié commencé en mai
→ premier mois de paie = mai
→ mois calendaire = 5

Salarié commencé en septembre
→ premier mois de paie = septembre
→ mois calendaire = 9
```

Il ne faut donc **jamais supposer automatiquement** :

```text
premier mois de paie = mois 1
```

Le moteur doit savoir quel est le **mois calendaire réel**.

---

## 3.1 Premier mois de paie : absence d'historique

Lorsqu'il s'agit du premier mois de paie du salarié, il n'existe aucun mois précédent dans l'historique.

Donc :

```javascript
previousMonths = []
```

Par conséquent :

```text
SNI cumulé
=
SNI du mois courant
```

Il n'y a aucun SNI précédent à additionner.

De même :

```text
IR déjà retenu
=
0
```

car aucun IR n'a encore été retenu pendant les mois précédents.

---

## 3.2 Exemple — Premier mois = janvier

Supposons :

```text
Mois = janvier
SNI = 4 000 DH
```

Il n'existe aucun mois précédent :

```javascript
previousMonths = []
```

Donc :

```text
SNI cumulé
=
4 000 DH
```

Le nombre de mois écoulés depuis janvier est :

```text
1
```

Annualisation :

```text
SNI annualisé
=
4 000 ÷ 1 × 12

=
48 000 DH
```

Ensuite, le moteur détermine la tranche IR correspondant à :

```text
48 000 DH
```

Puis :

```text
IR annuel théorique
-
IR déjà retenu

=
IR à retenir en janvier
```

Comme aucun IR n'a été retenu précédemment :

```text
IR déjà retenu = 0
```

---

## 3.3 Exemple — Premier mois = mai

Supposons maintenant que le salarié commence en mai.

```text
Mois calendaire = 5
SNI de mai = 4 000 DH
```

Le salarié n'a aucun historique de paie avant mai dans le système :

```javascript
previousMonths = []
```

Donc :

```text
SNI cumulé
=
4 000 DH
```

### Point extrêmement important

Le moteur ne doit pas automatiquement faire :

```text
elapsedMonths = 1
```

simplement parce que mai est le premier mois de paie du salarié.

Le moteur doit distinguer :

```text
firstPayrollMonth
```

de :

```text
calendarMonth
```

Si la règle de calcul utilise le **cumul depuis janvier**, alors mai correspond au :

```text
5ème mois de l'année
```

et non au 1er mois de l'année.

La valeur de `elapsedMonths` doit donc être déterminée selon la règle métier définie pour l'annualisation.

---

## 3.4 Exemple — Premier mois = septembre

Supposons :

```text
Mois = septembre
SNI = 6 000 DH
```

C'est le premier bulletin de paie du salarié.

Il n'existe donc aucun historique :

```javascript
previousMonths = []
```

Le cumul disponible est :

```text
SNI cumulé = 6 000 DH
```

Mais :

```text
premier bulletin de paie
≠
premier mois de l'année
```

Septembre reste le mois calendaire :

```text
9
```

Le moteur doit donc utiliser explicitement la définition métier de `elapsedMonths` au lieu de déduire automatiquement :

```text
elapsedMonths = 1
```

Cette distinction doit être conservée dans l'architecture du moteur.

---

# 4. Exemple simple

Supposons :

| Mois    |      SNI |
| ------- | -------: |
| Janvier | 4 000 DH |
| Février | 4 500 DH |
| Mars    | 5 000 DH |
| Avril   | 6 000 DH |

Le SNI change chaque mois.

---

# 5. Étape 1 — Calcul du SNI cumulé

En avril, on additionne tous les SNI depuis janvier.

```text
SNI cumulé
=
SNI janvier
+ SNI février
+ SNI mars
+ SNI avril
```

Donc :

```text
4 000
+ 4 500
+ 5 000
+ 6 000
= 19 500 DH
```

Résultat :

```text
SNI cumulé avril = 19 500 DH
```

---

# 6. Étape 2 — Annualisation

La grille IR est annuelle.

En avril, **4 mois** sont écoulés.

Le moteur annualise donc le SNI cumulé :

```text
SNI annualisé
=
SNI cumulé
÷ nombre de mois écoulés
× 12
```

En avril :

```text
19 500 ÷ 4 × 12
= 58 500 DH
```

Donc :

```text
SNI annualisé = 58 500 DH
```

Cela signifie que le moteur estime le revenu annuel sur la base du rythme observé pendant les mois déjà écoulés.

---

# 7. Étape 3 — Calcul de l'IR annuel théorique

Le moteur utilise ensuite la **grille annuelle de l'IR**.

Exemple de grille :

|           SNI annuel | Taux | Montant à déduire |
| -------------------: | ---: | ----------------: |
|        0 – 40 000 DH |  0 % |              0 DH |
|   40 001 – 60 000 DH | 10 % |          4 000 DH |
|   60 001 – 80 000 DH | 20 % |         10 000 DH |
|  80 001 – 100 000 DH | 30 % |         18 000 DH |
| 100 001 – 180 000 DH | 34 % |         22 000 DH |
|         > 180 000 DH | 37 % |         27 400 DH |

Pour un SNI annualisé de 58 500 DH :

```text
58 500 × 10 %
=
5 850 DH
```

Puis :

```text
5 850 − 4 000
=
1 850 DH
```

Donc :

```text
IR cumulé dû = 1 850 DH
```

---

# 8. Étape 4 — Déduire l'IR déjà retenu

Le moteur doit connaître l'IR déjà retenu pendant les mois précédents.

Exemple :

| Mois    | IR retenu |
| ------- | --------: |
| Janvier |    100 DH |
| Février |    150 DH |
| Mars    |    200 DH |

IR déjà retenu :

```text
100 + 150 + 200
=
450 DH
```

L'IR à retenir en avril devient :

```text
IR avril
=
IR cumulé dû
−
IR déjà retenu
```

Donc :

```text
1 850 − 450
=
1 400 DH
```

Résultat :

```text
IR à retenir en avril = 1 400 DH
```

---

# 9. Le SNI peut changer chaque mois

C'est une règle fondamentale.

Le moteur doit accepter des SNI différents :

```text
Janvier  → 4 000
Février  → 4 500
Mars     → 5 000
Avril    → 6 000
```

Il ne faut PAS faire :

```text
SNI annuel = SNI avril × 12
```

Cette approche est incorrecte pour le calcul cumulatif.

Il faut d'abord calculer :

```text
SNI cumulé
=
somme des SNI de janvier au mois courant
```

Puis :

```text
SNI annualisé
=
SNI cumulé ÷ mois écoulés × 12
```

---

# 10. Exemple montrant pourquoi le cumul est nécessaire

Supposons :

| Mois    |      SNI |
| ------- | -------: |
| Janvier | 3 000 DH |
| Février | 4 000 DH |
| Mars    | 7 000 DH |

En mars :

```text
SNI cumulé
=
3 000 + 4 000 + 7 000
=
14 000 DH
```

Annualisation :

```text
14 000 ÷ 3 × 12
=
56 000 DH
```

Le moteur utilise donc **56 000 DH** pour déterminer l'IR annuel théorique.

Il ne doit pas utiliser uniquement :

```text
7 000 × 12
=
84 000 DH
```

car cela ignorerait les deux mois précédents.

---

# 11. Recalcul chaque mois

Le calcul doit être effectué à nouveau chaque mois.

## Janvier

```text
SNI cumulé = SNI janvier

SNI annualisé
=
SNI cumulé ÷ 1 × 12

Calcul IR annuel théorique

− IR déjà retenu
= 0

IR janvier
```

---

## Février

```text
SNI cumulé
=
janvier + février

SNI annualisé
=
SNI cumulé ÷ 2 × 12

Calcul IR annuel théorique

− IR déjà retenu en janvier

=
IR février
```

---

## Mars

```text
SNI cumulé
=
janvier + février + mars

SNI annualisé
=
SNI cumulé ÷ 3 × 12

Calcul IR annuel théorique

− IR déjà retenu en janvier + février

=
IR mars
```

---

## Avril

```text
SNI cumulé
=
janvier + février + mars + avril

SNI annualisé
=
SNI cumulé ÷ 4 × 12

Calcul IR annuel théorique

− IR déjà retenu en janvier + février + mars

=
IR avril
```

---

# 12. Cas particulier — Salarié qui commence en cours d'année

Ce cas doit être explicitement géré par le moteur.

Exemple :

```text
Salarié commence en mai
```

Il n'a pas de paie de janvier, février, mars ou avril.

Son premier bulletin est donc :

```text
Mai
```

Les données peuvent être :

```javascript
{
  month: 5,
  monthlySNI: 4000,
  previousMonths: []
}
```

Il faut alors distinguer deux informations :

```text
month = 5
```

signifie :

```text
mai dans l'année
```

tandis que :

```text
previousMonths = []
```

signifie :

```text
aucun historique de paie disponible pour ce salarié
```

Ces deux informations ne doivent pas être confondues.

### Règle d'architecture

Le moteur ne doit jamais déduire :

```text
previousMonths.length + 1
```

comme étant automatiquement le nombre de mois écoulés dans l'année.

Exemple :

```text
Mai
previousMonths = []
```

donne :

```text
nombre de mois d'historique = 0
```

mais :

```text
mois calendaire = 5
```

Ce sont deux concepts différents.

---

# 13. Formules à implémenter

## SNI cumulé

Si le calcul est basé sur le cumul depuis janvier :

```javascript
cumulativeSNI =
  sum(SNI from January to current month)
```

Dans le cas où aucun mois précédent n'existe :

```javascript
cumulativeSNI = currentMonthSNI
```

---

## SNI annualisé

```javascript
annualizedSNI =
  (cumulativeSNI / elapsedMonths) * 12
```

`elapsedMonths` doit représenter le **nombre de mois réellement pris en compte par la règle d'annualisation**.

Il ne faut pas automatiquement utiliser :

```javascript
previousMonths.length + 1
```

sans vérifier la règle métier.

---

## IR annuel théorique

```javascript
annualIR =
  calculateIRFromAnnualBrackets(annualizedSNI)
```

---

## IR déjà retenu

```javascript
previousIRWithheld =
  sum(IR withheld from previous months)
```

S'il s'agit du premier mois de paie :

```javascript
previousIRWithheld = 0
```

---

## IR du mois courant

```javascript
currentMonthIR =
  annualIR - previousIRWithheld
```

---

# 14. Règles importantes pour l'implémentation

## Règle 1 — Ne pas utiliser uniquement le salaire du mois

Incorrect :

```javascript
annualizedSNI = currentMonthSNI * 12
```

Correct dans une logique cumulative :

```javascript
annualizedSNI =
  (cumulativeSNI / elapsedMonths) * 12
```

---

## Règle 2 — Le calcul est cumulatif

Le mois courant doit inclure tous les mois précédents disponibles dans la période de cumul.

```text
Janvier

Janvier + Février

Janvier + Février + Mars

Janvier + Février + Mars + Avril

...
```

---

## Règle 3 — Le premier mois n'a pas d'historique précédent

Si le salarié est à son premier bulletin :

```javascript
previousMonths = []
```

Alors :

```text
cumulativeSNI = currentMonthSNI
```

et :

```text
previousIRWithheld = 0
```

---

## Règle 4 — Premier mois de paie ≠ mois 1

Un salarié peut commencer en :

```text
Janvier → mois 1
Mai     → mois 5
Septembre → mois 9
```

Le système doit conserver le **mois calendaire réel**.

Il ne faut pas transformer automatiquement le premier bulletin en :

```text
month = 1
```

---

## Règle 5 — Le calcul du nombre de mois écoulés doit être explicite

Le moteur doit avoir une définition claire de :

```text
elapsedMonths
```

Il ne faut pas supposer que :

```javascript
elapsedMonths = previousMonths.length + 1
```

est toujours correct.

Exemple :

```text
Mois calendaire = septembre
previousMonths = []
```

Cela signifie :

```text
premier bulletin du salarié
```

mais pas :

```text
septembre = premier mois de l'année
```

---

## Règle 6 — L'IR déjà retenu doit être déduit

Le système ne doit pas faire payer deux fois le même IR.

```text
IR du mois
=
IR cumulé dû
−
IR déjà retenu
```

---

## Règle 7 — Le SNI mensuel peut changer

Chaque mois doit utiliser la valeur réelle du SNI de ce mois.

---

## Règle 8 — Le moteur doit pouvoir changer de tranche

L'annualisation peut faire passer le salarié d'une tranche IR à une autre.

Exemple :

```text
Mois précédent → tranche 10 %

Mois courant → tranche 20 %
```

Le moteur doit toujours recalculer la tranche à partir du :

```text
SNI annualisé actuel
```

---

## Règle 9 — Ne pas additionner les IR théoriques mensuels

Il ne faut pas faire :

```text
IR théorique janvier
+
IR théorique février
+
IR théorique mars
+
IR théorique avril
```

Le moteur doit recalculer l'IR annuel théorique à partir du SNI cumulé et soustraire l'IR déjà retenu.

---

# 15. Données minimales nécessaires

Pour un salarié ayant déjà trois mois d'historique :

```javascript
{
  month: 4,

  monthlySNI: 6000,

  previousMonths: [
    {
      month: 1,
      SNI: 4000,
      IRWithheld: 100
    },
    {
      month: 2,
      SNI: 4500,
      IRWithheld: 150
    },
    {
      month: 3,
      SNI: 5000,
      IRWithheld: 200
    }
  ]
}
```

Le moteur peut alors déterminer :

```text
SNI cumulé
        ↓
SNI annualisé
        ↓
Tranche IR
        ↓
IR annuel théorique
        ↓
IR déjà retenu
        ↓
IR du mois courant
```

---

# 16. Données minimales pour un premier mois de paie

Exemple : premier bulletin en janvier.

```javascript
{
  month: 1,

  monthlySNI: 4000,

  previousMonths: []
}
```

Résultat conceptuel :

```text
previousMonths
=
[]

cumulativeSNI
=
4000

previousIRWithheld
=
0
```

---

Exemple : premier bulletin en mai.

```javascript
{
  month: 5,

  monthlySNI: 4000,

  previousMonths: []
}
```

Résultat conceptuel :

```text
month
=
5

previousMonths
=
[]

cumulativeSNI
=
4000
```

Le moteur doit conserver `month = 5`.

Il ne doit pas transformer automatiquement :

```javascript
month: 5
```

en :

```javascript
month: 1
```

simplement parce qu'il s'agit du premier bulletin du salarié.

---

# 17. Ce que le moteur ne doit PAS faire

Ne pas :

* calculer l'IR uniquement sur le SNI du mois ;
* supposer que le SNI est identique chaque mois ;
* multiplier directement le SNI du mois par 12 dans une logique cumulative ;
* oublier les mois précédents ;
* oublier l'IR déjà retenu ;
* appliquer une tranche sans vérifier le SNI annualisé ;
* additionner les IR théoriques mensuels ;
* confondre le premier bulletin du salarié avec janvier ;
* transformer automatiquement le premier mois de paie en `month = 1` ;
* utiliser automatiquement `previousMonths.length + 1` comme `elapsedMonths` sans vérifier la règle métier ;
* confondre le mois calendaire avec le nombre de mois d'historique disponible.

---

# 18. Résumé

La logique complète est :

```text
1. Identifier le mois calendaire réel
                ↓
2. Vérifier s'il existe un historique précédent
                ↓
3. Récupérer le SNI du mois courant
                ↓
4. Ajouter les SNI précédents
                ↓
5. Obtenir le SNI cumulé
                ↓
6. Déterminer le nombre de mois écoulés
                ↓
7. Annualiser le SNI cumulé
                ↓
8. Trouver la tranche IR annuelle
                ↓
9. Calculer l'IR annuel théorique
                ↓
10. Additionner l'IR déjà retenu
                ↓
11. Soustraire l'IR déjà retenu
                ↓
12. Obtenir l'IR à retenir ce mois
```

### Formule finale

```text
IR à retenir ce mois

=

IR calculé sur le SNI annualisé cumulé

−

IR déjà retenu les mois précédents
```

### Principe fondamental

```text
Premier bulletin
≠
Premier mois de l'année
```

Un salarié peut avoir son premier bulletin en janvier, mai ou septembre.

Le moteur doit toujours conserver le **mois calendaire réel** et traiter séparément l'absence ou la présence d'un historique de paie.

**Cette logique doit être utilisée comme référence pour l'implémentation du calcul de l'IR cumulatif.**
