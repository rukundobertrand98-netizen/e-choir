import assert from 'node:assert/strict'
import test from 'node:test'
import { localeCode, translateText } from '../i18n.js'

test('interface text uses the selected account language', () => {
  assert.equal(translateText('EN', 'Treasurer dashboard'), 'Treasurer dashboard')
  assert.equal(translateText('RW', 'Treasurer dashboard'), 'Incamake y’umubitsi')
  assert.equal(translateText('FR', 'Treasurer dashboard'), 'Tableau de bord du trésorier')
  assert.equal(translateText('FR', 'Search members…'), 'Rechercher des membres…')
})

test('unknown or user-provided text is preserved', () => {
  assert.equal(translateText('FR', 'A choir-specific announcement'), 'A choir-specific announcement')
})

test('ticket statuses and priorities can be translated from their display labels', () => {
  assert.equal(translateText('RW', 'Open'), 'Bifunguye')
  assert.equal(translateText('FR', 'In progress'), 'En cours')
  assert.equal(translateText('FR', 'Closed'), 'Fermé')
  assert.equal(translateText('RW', 'Urgent'), 'Byihutirwa')
})

test('supported account languages use matching locale identifiers', () => {
  assert.equal(localeCode('EN'), 'en')
  assert.equal(localeCode('RW'), 'rw-RW')
  assert.equal(localeCode('FR'), 'fr-FR')
})
