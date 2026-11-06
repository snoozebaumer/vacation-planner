import { Injectable, signal } from '@angular/core';

export type Lang = 'en' | 'de';

const STORAGE_KEY = 'vacationplanner-lang';

type Dict = Record<string, Record<Lang, string>>;

const DICT: Dict = {
  'common.back': { en: 'Back', de: 'Zurück' },
  'common.cancel': { en: 'Cancel', de: 'Abbrechen' },
  'common.continue': { en: 'Continue', de: 'Weiter' },
  'common.retry': { en: 'Retry', de: 'Erneut versuchen' },
  'common.ranking': { en: 'Ranking', de: 'Rangliste' },

  'vacationSelect.title': { en: 'Which vacation are you planning?', de: 'Welche Ferien planst du?' },
  'vacationSelect.addLabel': { en: 'New vacation', de: 'Neue Ferien' },
  'vacationSelect.preparing': { en: 'Preparing…', de: 'Wird vorbereitet…' },
  'vacationSelect.planning': { en: 'Planning…', de: 'In Planung…' },
  'vacationSelect.placesCountOne': { en: '{count} place', de: '{count} Ort' },
  'vacationSelect.placesCountOther': { en: '{count} places', de: '{count} Orte' },
  'vacationSelect.daysCountOne': { en: '{count} day', de: '{count} Tag' },
  'vacationSelect.daysCountOther': { en: '{count} days', de: '{count} Tage' },
  'vacationSelect.createdByTooltip': { en: 'Created by {name}', de: 'Erstellt von {name}' },
  'vacationSelect.searchPlaceholder': { en: 'Search vacations…', de: 'Ferien suchen…' },
  'vacationSelect.noResults': { en: 'No vacations match your search.', de: 'Keine Ferien gefunden.' },
  'vacationSelect.selectMenuLabel': { en: 'Select', de: 'Auswählen' },
  'vacationSelect.deleteMenuLabel': { en: 'Delete', de: 'Löschen' },
  'vacationSelect.deleteTitle': { en: 'Delete "{vacation}"?', de: '„{vacation}" löschen?' },
  'vacationSelect.deleteWarning': {
    en: 'This permanently deletes every place, vote, priority, and veto for this vacation. This cannot be undone.',
    de: 'Dies löscht dauerhaft alle Orte, Stimmen, Prioritäten und Vetos für diese Ferien. Dies kann nicht rückgängig gemacht werden.',
  },
  'vacationSelect.deletePasswordLabel': { en: 'Password', de: 'Passwort' },
  'vacationSelect.deleteButton': { en: 'Delete', de: 'Löschen' },
  'vacationSelect.deletingButton': { en: 'Deleting…', de: 'Wird gelöscht…' },
  'vacationSelect.deleteWrongPassword': { en: 'Incorrect password.', de: 'Falsches Passwort.' },
  'vacationSelect.deleteError': {
    en: 'Could not delete the vacation. Please try again.',
    de: 'Ferien konnten nicht gelöscht werden. Bitte erneut versuchen.',
  },

  'userSelect.title': { en: 'Who is planning {vacation}?', de: 'Wer plant {vacation}?' },
  'userSelect.addLabel': { en: 'New person', de: 'Neue Person' },
  'userSelect.dialogTitle': { en: "What's your name?", de: 'Wie heisst du?' },
  'userSelect.nameLabel': { en: 'Name', de: 'Name' },
  'userSelect.createError': {
    en: 'Could not create user, please try again.',
    de: 'User konnte nicht angelegt werden, bitte erneut versuchen.',
  },
  'userSelect.nameLengthError': {
    en: 'Name must be between 3 and 100 characters.',
    de: 'Name muss zwischen 3 und 100 Zeichen lang sein.',
  },
  'userSelect.shareLabel': { en: 'Share this vacation with your friends', de: 'Teile diese Ferien mit deinen Freunden' },
  'userSelect.copyTitle': { en: 'Copy link', de: 'Link kopieren' },

  'vacationCreate.preparingTitle': { en: 'Preparing "{name}"…', de: '„{name}“ wird vorbereitet…' },
  'vacationCreate.researchingProgress': {
    en: 'Researching places and fetching photos ({processed} / {total})',
    de: 'Orte werden recherchiert und Fotos geladen ({processed} / {total})',
  },
  'vacationCreate.etaEstimating': { en: 'Estimating time remaining…', de: 'Verbleibende Zeit wird geschätzt…' },
  'vacationCreate.etaAlmostDone': { en: 'Almost done…', de: 'Fast fertig…' },
  'vacationCreate.etaSeconds': { en: 'About {seconds}s remaining', de: 'Noch etwa {seconds}s' },
  'vacationCreate.etaMinutes': { en: 'About {minutes} min remaining', de: 'Noch etwa {minutes} Min.' },
  'vacationCreate.title': { en: 'Plan a new vacation', de: 'Neue Ferien planen' },
  'vacationCreate.nameLabel': { en: 'Vacation name', de: 'Name der Ferien' },
  'vacationCreate.namePlaceholder': { en: 'e.g. Japan Spring 2027', de: 'z. B. Japan Frühling 2027' },
  'vacationCreate.durationLabel': { en: 'Duration (days)', de: 'Dauer (Tage)' },
  'vacationCreate.activeHoursLabel': { en: 'Active hours / day', de: 'Stunden unterwegs / Tag' },
  'vacationCreate.travelTimeLabel': {
    en: 'Avg travel time between places (h)',
    de: 'Ø Reisezeit zwischen Orten (Std.)',
  },
  'vacationCreate.submitButton': { en: 'Create vacation', de: 'Ferien erstellen' },
  'vacationCreate.createError': {
    en: 'Failed to create vacation. Please try again.',
    de: 'Ferien konnten nicht erstellt werden. Bitte erneut versuchen.',
  },
  'vacationCreate.processingFailed': {
    en: 'Vacation creation failed. Please try again.',
    de: 'Erstellen der Ferien fehlgeschlagen. Bitte erneut versuchen.',
  },
  'vacationCreate.privateLabel': { en: 'Make this vacation private', de: 'Diese Ferien privat machen' },
  'vacationCreate.passwordLabel': { en: 'Password', de: 'Passwort' },

  'vacationPlaces.title': { en: 'Add places to {vacation}', de: 'Orte zu {vacation} hinzufügen' },
  'vacationPlaces.intro': {
    en: 'Add places or activities together, at your own pace. Anyone with the link can join in until ranking starts.',
    de: 'Fügt gemeinsam und in eurem eigenen Tempo Orte oder Aktivitäten hinzu. Jeder mit dem Link kann mitmachen, bis das Ranking startet.',
  },
  'vacationPlaces.addLabel': { en: 'Add places (one per line)', de: 'Orte hinzufügen (einer pro Zeile)' },
  'vacationPlaces.addPlaceholder': {
    en: 'Eiffel Tower\nLouvre Museum\nMontmartre walking tour',
    de: 'Eiffelturm\nLouvre\nMontmartre Walking Tour',
  },
  'vacationPlaces.addButton': { en: 'Add', de: 'Hinzufügen' },
  'vacationPlaces.addingButton': { en: 'Adding…', de: 'Wird hinzugefügt…' },
  'vacationPlaces.editAction': { en: 'Rename', de: 'Umbenennen' },
  'vacationPlaces.deleteAction': { en: 'Delete', de: 'Löschen' },
  'vacationPlaces.noPlaces': { en: 'No places yet — add some below.', de: 'Noch keine Orte — unten hinzufügen.' },
  'vacationPlaces.conflictError': {
    en: 'This was changed by someone else — refreshed with the latest.',
    de: 'Wurde von jemand anderem geändert — mit dem neuesten Stand aktualisiert.',
  },
  'vacationPlaces.mutationError': {
    en: 'That didn\'t work. Please try again.',
    de: 'Das hat nicht funktioniert. Bitte erneut versuchen.',
  },
  'vacationPlaces.prefsTitle': { en: 'Trip pacing', de: 'Reisetempo' },
  'vacationPlaces.prefsNote': {
    en: 'Your own preference — the trip uses the median of everyone who submits one before ranking starts.',
    de: 'Deine eigene Einschätzung — die Reise nutzt den Median aller, die vor dem Start des Rankings etwas eintragen.',
  },
  'vacationPlaces.startRankingButton': { en: 'Start ranking', de: 'Ranking starten' },
  'vacationPlaces.startingButton': { en: 'Starting…', de: 'Wird gestartet…' },
  'vacationPlaces.needTwoPlaces': {
    en: 'At least 2 places are needed to start ranking.',
    de: 'Mindestens 2 Orte werden benötigt, um das Ranking zu starten.',
  },
  'vacationPlaces.confirmTitle': { en: 'Start ranking?', de: 'Ranking starten?' },
  'vacationPlaces.confirmWarning': {
    en: 'From here on, places and the trip pacing preferences can no longer be edited. Everyone can still weigh, rank, and veto once it\'s ready.',
    de: 'Ab jetzt können Orte und die Reisetempo-Einstellungen nicht mehr geändert werden. Sobald alles bereit ist, können weiterhin alle gewichten, ranken und Vetos einlegen.',
  },
  'vacationPlaces.startRankingError': {
    en: 'Could not start ranking. Please try again.',
    de: 'Ranking konnte nicht gestartet werden. Bitte erneut versuchen.',
  },

  'vacationUnlock.title': { en: '"{vacation}" is private', de: '„{vacation}" ist privat' },
  'vacationUnlock.hint': { en: 'Enter the password to continue.', de: 'Gib das Passwort ein, um fortzufahren.' },
  'vacationUnlock.passwordLabel': { en: 'Password', de: 'Passwort' },
  'vacationUnlock.submitButton': { en: 'Unlock', de: 'Entsperren' },
  'vacationUnlock.submittingButton': { en: 'Checking…', de: 'Wird geprüft…' },
  'vacationUnlock.wrongPassword': { en: 'Incorrect password.', de: 'Falsches Passwort.' },
  'vacationUnlock.error': {
    en: 'Could not check the password. Please try again.',
    de: 'Passwort konnte nicht geprüft werden. Bitte erneut versuchen.',
  },

  'matchup.roundsPlayed': { en: 'Rounds played: {count}', de: 'Gespielte Runden: {count}' },
  'matchup.prompt': { en: 'Which would you rather visit?', de: 'Was würdest du lieber besuchen?' },
  'matchup.loadError': {
    en: 'Could not load a matchup. Please try again.',
    de: 'Duell konnte nicht geladen werden. Bitte erneut versuchen.',
  },
  'matchup.voteError': {
    en: 'Could not record your choice. Please try again.',
    de: 'Deine Wahl konnte nicht gespeichert werden. Bitte erneut versuchen.',
  },
  'matchup.adjustPrioritiesTitle': { en: 'Adjust your priorities', de: 'Deine Prioritäten anpassen' },

  'ranking.keepRankingButton': { en: 'Keep ranking', de: 'Weiter ranken' },
  'ranking.adjustPrioritiesTitle': { en: 'Adjust your priorities', de: 'Deine Prioritäten anpassen' },
  'ranking.budgetNote': {
    en: 'Trip budget: {days} days × ({hours}h active − 1h tolerance) ≈ {budget}h total, split across categories below by everyone\'s priorities.',
    de: 'Reisebudget: {days} Tage × ({hours} Std. aktiv − 1 Std. Toleranz) ≈ {budget} Std. insgesamt, aufgeteilt auf die Kategorien unten gemäss den Prioritäten aller.',
  },
  'ranking.bucketBudget': { en: '{budget}h budget', de: '{budget} Std. Budget' },
  'ranking.budgetDonorNote': { en: 'Everything fits — spare hours were shared.', de: 'Alles passt — übrige Stunden geteilt.' },
  'ranking.budgetRecipientNote': { en: "Didn't fit alone — topped up from elsewhere.", de: 'Passte nicht allein — mit Stunden aufgefüllt.' },
  'ranking.budgetExplainerTitle': { en: 'What is happening here?', de: 'Was passiert hier?' },
  'ranking.budgetExplainerBody': {
    en: 'Categories with time to spare lend it to categories that need more. The highest-weighted category whose next place needs the least extra time benefits first.',
    de: 'Kategorien mit übriger Zeit leihen sie an Kategorien aus, die mehr brauchen. Zuerst profitiert die höchstgewichtete Kategorie, deren nächster Ort am wenigsten zusätzliche Zeit braucht.',
  },
  'ranking.uncategorizedNote': {
    en: "These places couldn't be sorted into a category automatically.",
    de: 'Diese Orte konnten nicht automatisch einer Kategorie zugeordnet werden.',
  },
  'ranking.retryButton': { en: 'Retry categorization', de: 'Kategorisierung wiederholen' },
  'ranking.retryingButton': { en: 'Retrying…', de: 'Wird wiederholt…' },
  'ranking.retryError': {
    en: 'Could not retry categorization. Please try again.',
    de: 'Wiederholung fehlgeschlagen. Bitte erneut versuchen.',
  },
  'ranking.noDuelsNotice': {
    en: "Nothing to duel right now — every ready place is currently the only one in its category. Here's how things stand so far.",
    de: 'Aktuell nichts zum Duellieren — jeder fertige Ort ist momentan der einzige in seiner Kategorie. Hier siehst du den aktuellen Stand.',
  },
  'ranking.noBucketsYet': {
    en: 'No categorized places yet — check back once research finishes.',
    de: 'Noch keine kategorisierten Orte — sobald die Recherche fertig ist, hier nachsehen.',
  },
  'ranking.exportButton': { en: 'Export for Google My Maps', de: 'Für Google My Maps exportieren' },
  'ranking.exportingButton': { en: 'Exporting…', de: 'Wird exportiert…' },
  'ranking.cutoffLine': {
    en: '— time budget reached above this line —',
    de: '— Zeitbudget oberhalb dieser Linie erreicht —',
  },
  'ranking.vetoBadge': { en: "📌 {name}'s veto", de: '📌 Veto von {name}' },
  'ranking.removeVetoTitle': { en: 'Remove your veto', de: 'Dein Veto entfernen' },
  'ranking.vetoTitle': {
    en: 'Veto: guarantee this a spot within the time budget, even ahead of higher-ranked places',
    de: 'Veto: sichert diesem Ort einen Platz im Zeitbudget, auch vor höher platzierten Orten',
  },
  'ranking.personalRankings': { en: 'Personal rankings', de: 'Persönliche Ranglisten' },
  'ranking.prioritiesChartTitle': { en: "Everyone's priorities", de: 'Prioritäten' },
  'ranking.voteCastOne': { en: '{count} vote cast', de: '{count} Stimme abgegeben' },
  'ranking.voteCastOther': { en: '{count} votes cast', de: '{count} Stimmen abgegeben' },
  'ranking.noPlacesYet': { en: 'No places to rank yet.', de: 'Noch keine Orte zum Ranken.' },
  'ranking.loadError': { en: 'Could not load the ranking.', de: 'Rangliste konnte nicht geladen werden.' },
  'ranking.vetoSetError': {
    en: 'Could not set veto. Please try again.',
    de: 'Veto konnte nicht gesetzt werden. Bitte erneut versuchen.',
  },
  'ranking.vetoRemoveError': {
    en: 'Could not remove veto. Please try again.',
    de: 'Veto konnte nicht entfernt werden. Bitte erneut versuchen.',
  },
  'ranking.exportNothing': {
    en: 'Nothing to export yet — no places fall within the time budget.',
    de: 'Noch nichts zu exportieren — kein Ort passt ins Zeitbudget.',
  },
  'ranking.exportSuccessOne': {
    en: 'Downloaded {count} CSV layer — import it as a new layer in Google My Maps.',
    de: '{count} CSV-Ebene heruntergeladen — importiere sie als neue Ebene in Google My Maps.',
  },
  'ranking.exportSuccessOther': {
    en: 'Downloaded {count} CSV layers — import each as a new layer in Google My Maps.',
    de: '{count} CSV-Ebenen heruntergeladen — importiere jede als neue Ebene in Google My Maps.',
  },
  'ranking.exportError': {
    en: 'Could not export to CSV. Please try again.',
    de: 'CSV-Export fehlgeschlagen. Bitte erneut versuchen.',
  },

  'bucketWeights.title': { en: 'What matters most to you?', de: 'Was ist dir am wichtigsten?' },
  'bucketWeights.summaryTitle': { en: 'Priorities', de: 'Prioritäten' },
  'bucketWeights.intro': {
    en: "Split 100% across these categories to set how much of the trip's time budget each one gets. Places are only ever ranked against others in the same category.",
    de: 'Verteile 100% auf diese Kategorien, um festzulegen, wie viel vom Zeitbudget der Reise auf jede entfällt. Orte werden immer nur mit anderen aus derselben Kategorie verglichen.',
  },
  'bucketWeights.saveButton': { en: 'Save priorities', de: 'Prioritäten speichern' },
  'bucketWeights.savingButton': { en: 'Saving…', de: 'Wird gespeichert…' },
  'bucketWeights.loadError': {
    en: 'Could not load categories. Please try again.',
    de: 'Kategorien konnten nicht geladen werden. Bitte erneut versuchen.',
  },
  'bucketWeights.saveError': {
    en: 'Could not save your priorities. Please try again.',
    de: 'Prioritäten konnten nicht gespeichert werden. Bitte erneut versuchen.',
  },
  'bucketWeights.uncategorizedOne': {
    en: "{count} place couldn't be sorted into a category automatically.",
    de: '{count} Ort konnte nicht automatisch einer Kategorie zugeordnet werden.',
  },
  'bucketWeights.uncategorizedOther': {
    en: "{count} places couldn't be sorted into a category automatically.",
    de: '{count} Orte konnten nicht automatisch einer Kategorie zugeordnet werden.',
  },
  'bucketWeights.retryError': {
    en: 'Could not retry categorization. Please try again.',
    de: 'Wiederholung fehlgeschlagen. Bitte erneut versuchen.',
  },
  'bucketWeights.totalHint': {
    en: 'These must add up to 100% — currently {total}%.',
    de: 'Die Summe muss 100% ergeben — aktuell {total}%.',
  },

  'langToggle.switchToGerman': { en: 'Auf Deutsch umschalten', de: 'Auf Deutsch umschalten' },
  'langToggle.switchToEnglish': { en: 'Switch to English', de: 'Switch to English' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly lang = signal<Lang>(this.detectInitialLang());

  readonly currentLang = this.lang.asReadonly();

  private detectInitialLang(): Lang {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored === 'en' || stored === 'de') return stored;
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    return nav?.toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  setLang(lang: Lang): void {
    this.lang.set(lang);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  }

  toggle(): void {
    this.setLang(this.lang() === 'en' ? 'de' : 'en');
  }

  t(key: string, params?: Record<string, string | number>): string {
    const entry = DICT[key];
    let text = entry ? entry[this.lang()] : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  }
}
