/**
 * English dictionary, and the source of truth for the key set.
 *
 * Plain nested objects, so `t('toast.drillDeleted')` is a dotted path lookup.
 * A value is either a string, or `{one, other}` for anything that counts.
 *
 * `js/locales/es.js` must carry exactly these keys - the integration suite
 * fails the build otherwise, which is the point: a half-translated language
 * would otherwise ship silently and leave English words in the middle of a
 * Spanish screen.
 *
 * These are the English strings as they already appear in the app. Keys are
 * grouped by the screen that uses them, and the comment above each group says
 * which module owns them.
 */

export const en = {
    app: {
        title: 'Nova Drill Control'
    },

    // --- index.html: the hamburger menu and the header ---
    menu: {
        drill: 'Drill',
        downloadDrill: 'Download Drill',
        exportDrills: 'Export Drills',
        importDrills: 'Import Drills',
        settings: 'Settings',
        about: 'About',
        statistics: 'Statistics'
    },

    // --- index.html: the tabs above the drill list ---
    tab: {
        basic: 'Basic',
        combined: 'Combined',
        complex: 'Complex',
        'custom-a': 'Custom A',
        'custom-b': 'Custom B',
        'custom-c': 'Custom C'
    },

    // --- ui.js: the connection card, and index.html controls on it ---
    status: {
        disconnected: 'Disconnected',
        connected: 'Connected',
        connecting: 'Connecting…',
        picking: 'Pick your robot…',
        authorising: 'Authorising…',
        failed: 'Connection failed'
    },

    // --- index.html + ui.js: the control card and the footer ---
    label: {
        difficulty: 'DIFFICULTY LEVEL',
        count: 'Count',
        timeSeconds: 'Time (s)',
        pauseSeconds: 'Pause (s)',
        drillSelection: 'Drill Selection',
        shareCode: 'Share Code',
        selectDestination: 'Select Destination',
        drillNameMax40: 'Drill Name (Max 40)'
    },

    mode: {
        reps: 'Reps',
        time: 'Time'
    },

    // --- index.html: button captions. Shared by the modals, the editor and
    //     Settings, so they live here rather than being repeated per screen. ---
    action: {
        connect: 'Connect',
        disconnect: 'Disconnect',
        retry: 'Retry',
        save: 'Save',
        saveAs: 'Save As',
        saveDrill: 'Save Drill',
        downloadImport: 'Download & Import',
        test: 'Test',
        delete: 'Delete',
        remove: 'Remove',
        close: 'Close',
        open: 'Open',
        import: 'Import',
        reset: 'Reset',
        restore: 'Restore',
        erase: 'Erase',
        install: 'Install',
        newPreset: '+ New Preset',
        savePreset: 'Save Preset'
    },

    // --- index.html: modal titles ---
    modal: {
        importDrill: 'Import Drill',
        saveAsNew: 'Save As New Drill',
        ballPresets: 'Ball Presets',
        newPreset: 'New Preset',
        editPreset: 'Edit Preset',
        about: 'About',
        sessionSummary: 'Session Summary'
    },

    // --- runner.js + index.html: the run overlay ---
    run: {
        getReady: 'GET READY',
        go: 'GO!',
        remaining: 'REMAINING',
        pause: 'PAUSE',
        resume: 'RESUME',
        stop: 'STOP'
    },

    // --- index.html: the session summary pills ---
    summary: {
        complete: 'Training session complete!'
    },

    // --- index.html: the About modal ---
    about: {
        viewOnGithub: 'View on GitHub'
    },

    // --- ui.js: the footer counter. JS owns this line after boot; the markup
    //     copy only exists so the page reads right before then. ---
    footer: {
        totals: 'Balls: {balls} | Drills: {drills}',
        version: 'Version 2.4a'
    },

    // --- bluetooth.js: the sentences behind a failed connection. This is the
    //     most-read error text in the app, because connecting is the first
    //     thing anyone does at the table. ---
    ble: {
        pickerFailed: 'Could not open the device picker',
        noAnswer: 'The robot did not answer. Move it closer, make sure it is on, then try again.',
        noAuthorise: 'Connected to the robot but it did not finish authorising. Try again.',
        alreadyConnected: 'That robot is still connected to another tab. Disconnect it and try again.',
        notNova: 'That device does not look like a Nova robot.',
        noService: 'The robot answered but did not offer the Nova service. Check you picked the right device.',
        generic: 'Could not connect: {reason}'
    },

    // --- editor.js: the ball editor ---
    editor: {
        drillName: 'Drill Name',
        shareDrill: 'Share Drill',
        random: 'Random',
        testDrill: 'Test drill',
        ball: 'Ball {n}',
        variant: 'Variant {n}',
        addFromPreset: 'Add from preset',
        duplicateBall: 'Duplicate Ball',
        duplicateLastBall: 'Duplicate the last ball',
        addVariant: '+ Variant',
        saveBallAsPreset: 'Save this ball as a preset',
        rotation: 'Rotation:'
    },

    // --- editor.js + presetUi.js: the shared ball fields. Both forms show the
    //     same six, so they share one set of labels. ---
    field: {
        speed: 'Speed',
        spin: 'Spin',
        height: 'Height',
        drop: 'Drop',
        bpm: 'BPM',
        reps: 'Reps',
        scatter: 'Scatter',
        dropHint: 'L/R'
    },

    unit: {
        max: 'Max {n}',
        top: 'TOP',
        back: 'BACK',
        drills: 'Drills',
        balls: 'Balls',
        time: 'Time',
        sessions: 'Sessions',
        countDrills: {
            one: '{n} drill',
            other: '{n} drills'
        },
        countBalls: {
            one: '{n} ball',
            other: '{n} balls'
        },
    },

    // --- presetUi.js + presets.js: the preset sheet and editor. ---
    preset: {
        placement: 'Placement',
        depth: 'Depth',
        placementAxis: 'Placement (Drop L/R)',
        placementHint: 'Sideways target. Named from the receiver’s view, right-handed: backhand is a negative drop, forehand positive.',
        addPlacement: '+ Add placement',
        useStandardPlacements: 'Use BH / Center / FH',
        depthAxis: 'Depth (Height)',
        depthHint: 'How far the ball carries. Use this to go short / mid / long off the same serve.',
        addDepth: '+ Add depth',
        useStandardDepths: 'Use Short / Mid / Long',
        addBall: '+ Ball',
        variants: 'Variants',
        sequence: 'Sequence',
        empty: 'No presets yet.<br> Create one here, or save any ball from the drill editor as a preset.',
        titleOpenDrill: 'Open a drill to add presets',
        titleDrillFull: 'Drill is full ({max} balls)',
        editTitle: 'Edit preset',
        spot: 'Spot {n}',
        depthLabel: 'Depth {n}',
        addsOneBall: 'Adds 1 ball',
        addsBalls: 'Adds {n} balls ({placements} placements x {depths} depths)',
        describe: 'Speed {speed} · Spin {spin} · {type} · {bpm} bpm',
        newName: 'New preset'
    },

    // --- i18n.js: the built-in preset axis labels. Translated at render time
    //     because they are stored inside the preset, not just drawn. ---
    axis: {
        bh: 'BH',
        center: 'Center',
        fh: 'FH',
        short: 'Short',
        mid: 'Mid',
        long: 'Long'
    },

    // --- i18n.js: factory drill names, composed from these tokens. The keys
    //     themselves stay in English in storage and in the shared CSV. ---
    drill: {
        sep: ' ',
        stroke: {
            push: 'Push',
            drive: 'Drive',
            loop: 'Loop'
        },
        side: {
            b: '(B)',
            f: '(F)'
        },
        word: {
            random: 'Random',
            all: 'All'
        },
        newDrill: 'New Drill',
        sharedDrill: 'Shared Drill'
    },

    // --- settingsUi.js: the Settings screen ---
    settings: {
        appearance: 'Appearance',
        language: 'Language',
        languageDesc: 'Which language the app speaks.',
        presets: 'Presets',
        drills: 'Drills',
        statistics: 'Statistics',
        app: 'App',
        data: 'Data',
        managePresets: 'Manage presets',
        presetsInLibrary: '{n} in your library',
        exportPresets: 'Export presets',
        exportPresetsJsonDesc: 'JSON keeps everything. CSV is readable.',
        exportPresetsCsvDesc: 'Spreadsheet-friendly format.',
        importPresets: 'Import presets',
        importPresetsDesc: 'JSON or CSV. Names that already exist are skipped.',
        resetPresets: 'Reset preset library',
        resetPresetsDesc: 'Back to the 8 shipped presets.',
        saveAsDefault: 'Save as default',
        saveAsDefaultDesc: 'Restores the current drills on a factory reset.',
        restoreDefaults: 'Restore defaults',
        restoreDefaultsDesc: 'Back to the shipped drills, keeping your custom ones.',
        trainingHistory: 'Training history',
        trainingHistoryDesc: {
            one: '{n} session recorded.',
            other: '{n} sessions recorded.'
        },
        offlineUse: 'Offline use',
        offlineReady: 'Saved on this device. It opens and runs with no signal.',
        offlinePreparing: 'Preparing the offline copy…',
        installApp: 'Install app',
        installed: 'Installed',
        installedDesc: 'Open Nova from your home screen. It runs without a browser or a signal.',
        installableDesc: 'Puts Nova on your home screen so it opens like a normal app.',
        installDeclined: 'Not now. Your drills and settings are safe either way.',
        installUnsupported: 'This browser is not offering it. In Chrome, use the ⋮ menu → Add to Home screen.',
        resetStats: 'Reset statistics',
        resetStatsDesc: '{balls} balls · {drills} drills · clears the history too.',
        factoryReset: 'Factory reset',
        factoryResetDesc: 'Erases everything, including presets.',
        foot: 'Nova Drill Control · Version 2.4a'
    },

    // --- settingsUi.js: the theme cards. Themes are named, not styled. ---
    theme: {
        standard: 'Standard',
        ocean: 'Ocean',
        forest: 'Forest',
        night: 'Dark'
    },

    // --- statsUi.js: the statistics screen ---
    stats: {
        empty: 'No training recorded yet.<br><br>Sessions are logged automatically while the robot is connected, one per sitting. Nothing to set up.',
        emptySessions: 'No sessions yet. Play a drill with the robot connected and it will show up here.',
        live: 'Recording a session while the robot is connected.',
        mostPlayed: 'Most played',
        lastDays: 'Last {n} days',
        today: 'Today {time}',
        yesterday: 'Yesterday {time}',
        chartLabel: {
            one: '{date}: {n} drill',
            other: '{date}: {n} drills'
        },
        deleteAll: 'Delete all history',
        keepingLast: 'Keeping the last {n} sessions.'
    },

    // --- showToast() calls, everywhere ---
    toast: {
        default: 'Notification',
        installing: 'Installing Nova…',
        notConnected: 'Device not connected',
        configSaved: 'Configuration saved',
        openDrillFirst: 'Open a drill first',
        presetNotFound: 'Preset not found',
        drillFull: 'Drill is full ({max} balls)',
        onlyLeft: 'Only {n} left in this drill',
        ballsAdded: {
            one: '+{n} ball from “{name}”',
            other: '+{n} balls from “{name}”'
        },
        scatterLimit: 'Limit is {n} for this Drop position',
        cannotDeleteLastBall: 'Cannot delete last ball',
        enterAName: 'Enter a name',
        nameTooLong: 'Name too long',
        nameTooLong25: 'Name too long (Max 25)',
        nameTooLong30: 'Name too long (max 30)',
        invalidCharacters: 'Invalid characters',
        bankFull: 'Bank {bank} is full!',
        bankFullMax100: 'That bank is full (Max 100)!',
        categoryFull: 'Category is full (Max 100)',
        savedTo: 'Saved to {bank}',
        movedTo: 'Moved to {bank}',
        created: 'Created {name}',
        drillDeleted: 'Drill Deleted',
        renamed: 'Renamed',
        testBallFired: 'Test Ball Fired',
        testFailed: 'Test Failed',
        noActiveBalls: 'No active balls',
        noActiveBallsToPlay: 'no active balls to play',
        testingDrill: 'Testing Drill...',
        shareFailed: 'Share failed. Check network.',
        givePresetName: 'Give the preset a name',
        presetSaved: 'Preset “{name}” saved',
        presetDeleted: '“{name}” deleted',
        presetsExported: 'Presets exported',
        presetsImported: 'Imported {added} new, {updated} updated',
        nothingNewToImport: 'Nothing new to import',
        noPresetsInFile: 'No presets found in file',
        importFailed: 'Import failed',
        presetsReset: 'Presets reset to defaults',
        maxPerAxis: 'Max 6 per axis',
        sessionDeleted: 'Session deleted',
        sessionNotFound: 'Session not found',
        historyDeleted: 'History deleted',
        savedAsDefault: 'Saved as Default',
        restored: 'Restored',
        statsReset: 'Statistics Reset',
        drillsImported: 'Imported Successfully',
        drillsImportFailed: 'Import Failed',
        invalidCode: 'Invalid code (Must be 6 chars)',
        searching: 'Searching...',
        codeNotFound: 'Code not found',
        importedTo: 'Imported to {bank}',
        downloadError: 'Download Error'
    },

    // --- prompt() captions ---
    prompt: {
        newDrillName: 'Enter Name for New Drill:',
        renameDrill: 'Rename Drill:',
        shareCopy: 'Drill Shared! Copy this code:'
    },

    // --- confirm() messages ---
    confirm: {
        deleteDrill: 'Delete this drill?',
        deletePreset: 'Delete the preset “{name}”?',
        resetPresets: 'Replace the preset library with the shipped defaults? Presets already used in drills are not affected.',
        saveAsDefault: 'Save current settings as your new personal default?',
        restoreSaved: 'Restore saved defaults?',
        restoreFactory: 'Restore factory settings?',
        factoryReset: 'WARNING: Delete ALL saved data and return to original factory state?',
        resetStats: 'Reset stats? This clears the lifetime counters and all training history.',
        deleteAllSessions: 'Delete all training history? This cannot be undone.'
    },

    // --- alert() after a successful share ---
    alert: {
        shareSuccess: 'Drill Shared Successfully!\n\nCode: {code}\n\n(Copied to clipboard)'
    },

    // --- index.html: aria-labels and tooltips that are not visible text ---
    a11y: {
        backToDrills: 'Back to drills',
        backToSettings: 'Back to settings',
        deleteDrill: 'Delete',
        deletePreset: 'Delete preset',
        deleteSessionFrom: 'Delete session from {when}',
        deleteSessionTitle: 'Delete this session',
        createNewDrill: 'Create New Drill',
        dragToReorder: 'Drag to reorder',
        installApp: 'Install Nova'
    },

    placeholder: {
        myNewDrill: 'My New Drill',
        presetName: 'Preset name',
        label: 'Label',
        shareCode: 'ABC123'
    }
};
