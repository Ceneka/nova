/**
 * Español.
 *
 * Same keys as `en.js`, in the same order, so the two files can be diffed by
 * eye and the integration suite can walk both and fail on a gap.
 *
 * Terminology worth knowing before editing this file:
 *
 *   drill    -> ejercicio   "ejercicio" is what a coach calls a routine; "drill"
 *                          is left untranslated nowhere in this file, so the
 *                          app does not read half English.
 *   preset   -> preset       Widely used untranslated in Spanish software, and
 *                          the term matches the JSON/CSV files on disk.
 *   speed    -> velocidad
 *   spin     -> efecto       "Efecto" is the standard table-tennis word (topspin,
 *                          backspin, sidespin). "Giro" would also work but
 *                          "efecto" is what a player expects to read here.
 *   drop     -> posición     In this app Drop is the *lateral* placement, not
 *                          the height, so "posición" says what the field
 *                          actually does where a literal "caída" would not.
 *   reps     -> reps         Left as the abbreviation coaches already use.
 *   loop     -> Loop         The stroke name stays: "loop" is the term in use
 *                          on Spanish tables, and translating it to "globo"
 *                          would not match what players say out loud.
 *
 * TOP and BACK are also left alone, deliberately: those are the two spin
 * types the machine itself distinguishes, and the two words are the same in
 * every language the app is likely to be used in.
 */

export const es = {
    app: {
        title: 'Nova Drill | Tenisdemesa.ar',
        // The narrow form of the name, for a header too small for the full one.
        // A brand mark, so identical in both languages - see AGENTS.md.
        shortTitle: 'Nova'
    },

    // --- index.html: the hamburger menu and the header ---
    menu: {
        drill: 'Ejercicio',
        downloadDrill: 'Descargar ejercicio',
        exportDrills: 'Exportar ejercicios',
        importDrills: 'Importar ejercicios',
        settings: 'Ajustes',
        about: 'Acerca de',
        statistics: 'Estadísticas',
        ai: 'Asistente IA'
    },

    // --- index.html: the tabs above the drill list ---
    tab: {
        basic: 'Básico',
        combined: 'Combinados',
        complex: 'Complejos',
        'custom-a': 'Personal A',
        'custom-b': 'Personal B',
        'custom-c': 'Personal C',
        // "IA" is a brand mark, not a word: it is the same in both languages.
        ia: 'IA'
    },

    // --- ui.js: the connection card, and index.html controls on it ---
    status: {
        disconnected: 'Desconectado',
        connected: 'Conectado',
        connecting: 'Conectando…',
        picking: 'Elige tu robot…',
        authorising: 'Autorizando…',
        failed: 'Error de conexión'
    },

    // --- index.html: the control card and the footer ---
    label: {
        difficulty: 'NIVEL DE DIFICULTAD',
        count: 'Cantidad',
        timeSeconds: 'Tiempo (s)',
        pauseSeconds: 'Pausa (s)',
        drillSelection: 'Selección de ejercicio',
        shareCode: 'Código para compartir',
        selectDestination: 'Elegir destino',
        drillNameMax40: 'Nombre (máx. 40)'
    },

    mode: {
        reps: 'Reps',
        time: 'Tiempo'
    },

    // --- index.html: button captions ---
    action: {
        connect: 'Conectar',
        disconnect: 'Desconectar',
        retry: 'Reintentar',
        save: 'Guardar',
        saveAs: 'Guardar como',
        saveDrill: 'Guardar',
        downloadImport: 'Descargar e importar',
        test: 'Probar',
        delete: 'Eliminar',
        remove: 'Quitar',
        close: 'Cerrar',
        open: 'Abrir',
        import: 'Importar',
        reset: 'Restablecer',
        restore: 'Restaurar',
        erase: 'Borrar',
        install: 'Instalar',
        newPreset: '+ Nuevo preset',
        savePreset: 'Guardar preset',
        on: 'On',
        off: 'Off'
    },

    // --- index.html: modal titles ---
    modal: {
        importDrill: 'Importar ejercicio',
        saveAsNew: 'Guardar como nuevo',
        ballPresets: 'Presets de bola',
        newPreset: 'Nuevo preset',
        editPreset: 'Editar preset',
        about: 'Acerca de',
        sessionSummary: 'Resumen de la sesión'
    },

    // --- runner.js + index.html: the run overlay ---
    run: {
        getReady: 'PREPÁRATE',
        go: '¡YA!',
        remaining: 'RESTANTE',
        pause: 'PAUSA',
        resume: 'SEGUIR',
        stop: 'PARAR'
    },

    // --- index.html: the session summary pills ---
    summary: {
        complete: '¡Sesión de entrenamiento completada!'
    },

    // --- index.html: the About modal ---
    about: {
        viewOnGithub: 'Ver en GitHub',
        siteBlurb: 'Encontrá torneos de tenis de mesa en toda la Argentina.',
        thanks: 'Continuación independiente de la app Nova original. Gracias a su autor por el trabajo en el que se apoya.',
        originalProject: 'Ver el proyecto original'
    },

    // --- ui.js: the footer counter ---
    footer: {
        totals: 'Bolas: {balls} | Ejercicios: {drills}',
        version: 'Versión 2.4a'
    },

    // --- bluetooth.js: los mensajes de una conexion fallida ---
    ble: {
        pickerFailed: 'No se pudo abrir el selector de dispositivos',
        noAnswer: 'El robot no respondió. Acércalo, comprueba que está encendido y vuelve a intentarlo.',
        noAuthorise: 'Conectado al robot, pero no terminó la autorización. Inténtalo de nuevo.',
        alreadyConnected: 'Ese robot sigue conectado en otra pestaña. Desconéctalo e inténtalo de nuevo.',
        notNova: 'Ese dispositivo no parece un robot Nova.',
        noService: 'El robot respondió, pero no ofreció el servicio Nova. Comprueba que elegiste el dispositivo correcto.',
        generic: 'No se pudo conectar: {reason}'
    },

    // --- editor.js: the ball editor ---
    editor: {
        drillName: 'Nombre del ejercicio',
        shareDrill: 'Compartir ejercicio',
        random: 'Aleatorio',
        testDrill: 'Probar',
        ball: 'Bola {n}',
        variant: 'Variante {n}',
        addFromPreset: 'Añadir desde preset',
        duplicateBall: 'Duplicar bola',
        duplicateLastBall: 'Duplicar la última bola',
        addVariant: '+ Variante',
        saveBallAsPreset: 'Guardar esta bola como preset',
        rotation: 'Rotación:'
    },

    // --- editor.js + presetUi.js: the shared ball fields ---
    field: {
        speed: 'Velocidad',
        spin: 'Efecto',
        height: 'Altura',
        drop: 'Posición',
        bpm: 'BPM',
        reps: 'Reps',
        scatter: 'Dispersión',
        dropHint: 'I/D'
    },

    unit: {
        max: 'Máx. {n}',
        top: 'TOP',
        back: 'BACK',
        drills: 'Ejercicios',
        balls: 'Bolas',
        time: 'Tiempo',
        sessions: 'Sesiones',
        countDrills: {
            one: '{n} ejercicio',
            other: '{n} ejercicios'
        },
        countBalls: {
            one: '{n} bola',
            other: '{n} bolas'
        },
    },

    // --- presetUi.js + presets.js: the preset sheet and editor ---
    preset: {
        placement: 'Posición',
        depth: 'Profundidad',
        placementAxis: 'Posición (Drop I/D)',
        placementHint: 'Objetivo lateral. Se nombra desde el punto de vista del receptor, diestro: el revés es un drop negativo y la derecha positivo.',
        addPlacement: '+ Añadir posición',
        useStandardPlacements: 'Usar Rev. / Centro / Der.',
        depthAxis: 'Profundidad (Altura)',
        depthHint: 'Hasta dónde lleva la bola. Úsalo para sacar corto / medio / largo desde el mismo saque.',
        addDepth: '+ Añadir profundidad',
        useStandardDepths: 'Usar Corto / Medio / Largo',
        addBall: '+ Bola',
        variants: 'Variantes',
        sequence: 'Secuencia',
        empty: 'Todavía no hay presets.<br> Crea uno aquí, o guarda cualquier bola del editor de ejercicios como preset.',
        titleOpenDrill: 'Abre un ejercicio para añadir presets',
        titleDrillFull: 'El ejercicio está lleno ({max} bolas)',
        editTitle: 'Editar preset',
        spot: 'Punto {n}',
        depthLabel: 'Profundidad {n}',
        addsOneBall: 'Añade 1 bola',
        addsBalls: 'Añade {n} bolas ({placements} posiciones x {depths} profundidades)',
        describe: 'Velocidad {speed} · Efecto {spin} · {type} · {bpm} bpm',
        newName: 'Nuevo preset'
    },

    // --- i18n.js: the built-in preset axis labels ---
    axis: {
        bh: 'Rev.',
        center: 'Centro',
        fh: 'Der.',
        short: 'Corto',
        mid: 'Medio',
        long: 'Largo'
    },

    // --- i18n.js: factory drill names, composed from these tokens ---
    drill: {
        sep: ' · ',
        stroke: {
            push: 'Saque',
            drive: 'Golpe',
            loop: 'Loop'
        },
        side: {
            b: '(Rev.)',
            f: '(Der.)'
        },
        word: {
            random: 'Aleatorio',
            all: 'Todo'
        },
        newDrill: 'Nuevo ejercicio',
        sharedDrill: 'Ejercicio compartido'
    },

    // --- settingsUi.js: the Settings screen ---
    lang: {
        en: 'English',
        es: 'Español'
    },

    settings: {
        appearance: 'Apariencia',
        language: 'Idioma',
        languageDesc: 'En qué idioma está la aplicación.',
        presets: 'Presets',
        drills: 'Ejercicios',
        statistics: 'Estadísticas',
        app: 'Aplicación',
        data: 'Datos',
        managePresets: 'Gestionar presets',
        presetsInLibrary: '{n} en tu biblioteca',
        exportPresets: 'Exportar presets',
        exportPresetsJsonDesc: 'El JSON lo guarda todo. El CSV se puede leer.',
        exportPresetsCsvDesc: 'Formato para hoja de cálculo.',
        importPresets: 'Importar presets',
        importPresetsDesc: 'JSON o CSV. Los nombres que ya existen se omiten.',
        resetPresets: 'Restablecer la biblioteca de presets',
        resetPresetsDesc: 'Vuelve a los 8 presets incluidos.',
        saveAsDefault: 'Guardar como predeterminado',
        saveAsDefaultDesc: 'Restaura los ejercicios actuales tras un restablecimiento de fábrica.',
        restoreDefaults: 'Restaurar predeterminados',
        restoreDefaultsDesc: 'Vuelve a los ejercicios incluidos, conservando los tuyos.',
        trainingHistory: 'Historial de entrenamiento',
        trainingHistoryDesc: {
            one: '{n} sesión registrada.',
            other: '{n} sesiones registradas.'
        },
        offlineUse: 'Uso sin conexión',
        offlineReady: 'Guardado en este dispositivo. Se abre y funciona sin señal.',
        offlinePreparing: 'Preparando la copia sin conexión…',
        installApp: 'Instalar la app',
        installed: 'Instalada',
        installedDesc: 'Abre Nova desde tu pantalla de inicio. Funciona sin navegador y sin señal.',
        installableDesc: 'Coloca Nova en tu pantalla de inicio para que se abra como una app normal.',
        installDeclined: 'Ahora no. Tus ejercicios y ajustes están a salvo de todos modos.',
        sessionCount: {
            one: '{n} sesión',
            other: '{n} sesiones'
        },
        offlineReadyShort: 'Lista sin conexión',
        offlinePreparingShort: 'Preparando…',
        installUnsupported: 'Este navegador no lo ofrece. En Chrome, usa el menú ⋮ → Añadir a pantalla de inicio.',
        resetStats: 'Restablecer estadísticas',
        resetStatsDesc: '{balls} bolas · {drills} ejercicios · también borra el historial.',
        factoryReset: 'Restablecer de fábrica',
        factoryResetDesc: 'Borra todo, incluidos los presets.',
        foot: 'Nova Drill | Tenisdemesa.ar · Versión 2.4a'
    },

    // --- account.js / sync.js: la cuenta de tenisdemesa.ar ---
    //
    // Todo esto es opcional. La app guarda todo en localStorage y funciona sin
    // cuenta, así que esta sección es sólo un respaldo y el texto nunca da a
    // entender que la app la necesite.
    account: {
        section: 'Cuenta y respaldo',
        signedInShort: 'Sesión iniciada',
        signedOutShort: 'Sin sesión',
        signIn: 'Iniciar sesión',
        signInDesc: 'Usá tu cuenta de tenisdemesa.ar para tener un respaldo de tus drills.',
        signOut: 'Cerrar sesión',
        signOutDesc: 'Tus drills quedan en este dispositivo. Sólo se borra el respaldo.',
        backupNow: 'Respaldar ahora',
        backupNowDesc: 'Envía tus drills, presets e historial a tu cuenta.',
        restore: 'Restaurar respaldo',
        restoreDesc: 'Reemplaza lo que hay en este dispositivo por el último respaldo.',
        backupNever: 'Todavía sin respaldo',
        backupAt: 'Respaldado {when}',
        backupFailed: 'No se pudo hacer el respaldo.',
        backupDone: 'Respaldo hecho.',
        restoreNone: 'Todavía no hay ningún respaldo para restaurar.',
        restoreFailed: 'No se pudo restaurar.',
        restoreConfirm: '¿Reemplazar los drills de este dispositivo por tu último respaldo?',
        restoreDone: 'Se restauraron {n} cosas.',
        needAccount: 'Primero iniciá sesión.',
        // Lo único que alguien podría suponer que el respaldo se lleva.
        keyStaysHere: 'Tu clave de IA queda en este dispositivo y nunca se respalda.'
    },

    // --- ui.js: la pestaña IA ---
    ia: {
        emptyList: 'Todavía no hay nada. Armá un ejercicio en el asistente IA y guardalo, y aparece acá.',
        moveTo: 'Mover a {bank}',
        source: {
            voice: 'Hablado',
            text: 'Escrito',
            model: 'Del modelo'
        }
    },

    // --- aiConfig.js + settingsUi.js: la sección del asistente IA ---
    settingsAi: {
        section: 'Asistente IA',
        groupModel: 'Modelo',
        groupVoice: 'Voz',
        groupBehaviour: 'Cuándo escucha',
        notConfigured: 'Sin configurar',
        configured: 'Configurado',
        textModel: 'Modelo de texto',
        textModelDesc: 'Opcional. Sin él, el asistente igual lee los comandos cortos en este dispositivo, sin clave y sin señal.',
        voiceModel: 'Modelo de voz',
        voiceModelDesc: 'Transcribe lo que decís. Las respuestas habladas siguen usando la voz del navegador, que es gratis y funciona sin señal.',
        followText: 'Usar el modelo de texto también para la voz',
        followTextDesc: 'Sigue lo que tenga el modelo de texto ahora mismo.',
        detach: 'Separar',
        following: 'Siguiendo: {model}',
        provider: 'Proveedor',
        baseUrl: 'URL base',
        apiKey: 'Clave de API',
        model: 'Modelo',
        fetchModels: 'Ver modelos',
        testConnection: 'Probar conexión',
        speakReplies: 'Leer las respuestas',
        speakRepliesDesc: 'Dice la respuesta en voz alta con la voz del propio navegador.',
        remember: 'Recordar esta conversación',
        rememberDesc: 'Apagado: el historial es de esta sesión y se va al cerrar la pestaña.',
        clearKey: 'Borrar la clave de API',
        clearKeyDesc: 'Olvida la clave en este dispositivo. Todo lo demás queda.',
        keyStored: 'Guardada en este dispositivo y enviada solo a la URL de arriba.',
        keySessionOnly: 'Solo de sesión: la clave queda en memoria y se va al cerrar esta pestaña.',
        keyWarning: 'La clave se guarda en el almacenamiento local de este navegador, que puede leer cualquier script del sitio. Está bien en tu propio teléfono y no está bien en una máquina compartida: ahí usá la opción de solo sesión.',
        sessionOnly: 'Guardar la clave solo en memoria',
        language: 'Idioma de la respuesta',
        languageInherit: 'Igual que la app',
        never: 'sin probar',
        testing: 'Probando\u2026',
        ok: 'Conectado. El modelo respondió.',
        // Alcanzó el endpoint, pero el modelo gastó todo el presupuesto
        // pensando y no envió palabras. Eso no es una conexión fallida.
        okSpentBudget: 'Conectado. El modelo usó todo su presupuesto de tokens pensando y no envió palabras: subí el límite o elegí un modelo que responda antes.',
        failed: 'No se pudo llegar a ese endpoint',
        noModels: 'El endpoint no devolvió modelos.',
        modelsLoaded: '{n} modelos cargados',
        cleared: 'Clave de API borrada',
        savedMsg: 'Ajustes de IA guardados'
    },

    provider: {
        openrouter: 'OpenRouter',
        openai: 'OpenAI',
        custom: 'Personalizado'
    },

    // --- settingsUi.js: the theme cards ---
    theme: {
        standard: 'Mesa',
        ocean: 'Océano',
        forest: 'Bosque',
        night: 'Violeta'
    },

    // --- statsUi.js: the statistics screen ---
    stats: {
        empty: 'Todavía no hay entrenamiento registrado.<br><br>Las sesiones se registran solas mientras el robot está conectado, una por sesión de juego. No hay nada que configurar.',
        emptySessions: 'Todavía no hay sesiones. Juega un ejercicio con el robot conectado y aparecerá aquí.',
        live: 'Registrando una sesión mientras el robot está conectado.',
        mostPlayed: 'Más usados',
        lastDays: 'Últimos {n} días',
        today: 'Hoy {time}',
        yesterday: 'Ayer {time}',
        chartLabel: {
            one: '{date}: {n} ejercicio',
            other: '{date}: {n} ejercicios'
        },
        deleteAll: 'Eliminar todo el historial',
        keepingLast: 'Se conservan las últimas {n} sesiones.'
    },

    // --- aiUi.js: el panel del asistente ---
    ai: {
        title: 'Asistente IA',
        back: 'Ejercicios',
        empty: 'Decí o escribí un ejercicio. Esto lee tu frase en este dispositivo: sin clave de API y sin señal.',
        placeholder: 'ej. push b, y luego saque largo cortado a la derecha',
        ask: 'Preguntarle a la IA',
        listening: 'Escuchando…',
        thinking: 'Pensando…',
        tierLocal: 'Leído en este dispositivo',
        tierModel: 'Respondido por el modelo',
        step: 'Paso {n}',
        generated: 'generado',
        notUnderstood: 'No pude leer «{text}». Probá «push b, y luego drive f fuerte», o preguntale al modelo.',
        // Sin modelo al que apuntar, la frase anterior ofrece algo que no
        // funciona. Esta dice la verdad y deja el camino de siempre.
        notUnderstoodNoModel: 'No pude leer «{text}». Probá «push b, y luego drive f fuerte», o configurá el modelo para preguntarle con tus propias palabras.',
        // La fila bajo el compositor, presente solo mientras no haya clave.
        modelUnset: 'El modelo no está configurado. Los ejercicios que este dispositivo puede leer siguen funcionando.',
        modelSetUp: 'Configurar el modelo',
        chipFrom: 'usando «{name}»',
        traceTool: 'called {name}',
        presetsFound: {
            one: '{n} preset looked at',
            other: '{n} presets looked at'
        },
        // Micrófono de presionar-y-mantener, para la ruta por API.
        holdToTalk: 'Mantené presionado para hablar',
        // La voz nunca se adivina, así que sin modelo de texto lo dice.
        voiceNeedsModel: 'Hablar necesita un modelo de texto y no hay ninguno configurado. No se adivina nada: configurá uno en Ajustes y hablá tranquilo.',
        voiceTranscribing: 'Escuchando…',
        voiceNoRecord: 'Este navegador no puede grabar audio, así que el micrófono está apagado. Escribí el ejercicio en su lugar — todo lo demás funciona igual.',
        wakeNeedsBrowser: 'La palabra de activación necesita el micrófono del navegador. Con un modelo de voz configurado, el micrófono graba y envía el clip, así que no queda nada escuchando una frase. Desasociá el modelo de voz en Ajustes para recuperar la palabra de activación.',
        chipGenerated: {
            one: '{n} bola generada',
            other: '{n} bolas generadas'
        },
        play: 'Jugar',
        openEditor: 'Abrir en el editor',
        save: 'Guardar',
        discard: 'Descartar',
        rename: 'Renombrar',
        needConnection: 'Conectá el robot para jugar un ejercicio.',
        needKey: 'El modelo necesita una clave de API. Agregala en Ajustes → Asistente IA.',
        offline: 'El modelo necesita conexión. Todo lo demás sigue funcionando.',
        voiceCloud: 'En este navegador, el reconocimiento de voz necesita conexión.',
        voiceUnsupported: 'Este navegador no puede escuchar. Escribí el ejercicio: todo lo demás funciona igual.',
        voiceNothingHeard: 'No se oyó nada en la grabación.',
        voiceErrorGeneric: 'La entrada por voz no funcionó. Escribí el ejercicio.',
        voiceErrorNotAllowed: 'Se denegó el acceso al micrófono. Permitilo, o escribí el ejercicio.',
        voiceErrorNoMic: 'No se encontró ningún micrófono.',
        voiceErrorNetwork: 'El reconocimiento de voz necesita conexión.',
        voiceErrorLanguage: 'Este navegador no habla ese idioma.',
        wake: 'Palabra de activación',
        wakeDesc: 'Mantiene el micrófono abierto y actúa solo cuando decís una de estas. Funciona con Nova en pantalla: el navegador deja de escuchar cuando cerrás la app o se apaga la pantalla.',
        wakePhrases: 'Frases de activación',
        wakePhrasesDesc: 'Separadas por comas. La primera es la más específica.',
        wakeArmed: 'Escuchando «{phrase}»',
        wakeHeard: 'Te escuché',
        wakeNothing: 'Escuché «{phrase}»: decí el ejercicio después.',
        armMic: 'Mantener el micrófono abierto',
        arming: 'Micrófono abierto. Decí la palabra de activación, o tocá para cerrar.',
        disarmed: 'Micrófono cerrado',
        screenLock: 'Mantener la pantalla encendida',
        screenLockDesc: 'Evita que el teléfono se duerma mientras el asistente está abierto. También mantiene vivo el micrófono, que es lo que necesita la palabra de activación.',
        screenLockUnsupported: 'Este navegador no puede mantener la pantalla encendida.',
        screenLockDenied: 'El navegador no lo concedió; la pantalla se va a dormir como siempre.',
        confirmDiscard: '¿Descartar este borrador?',
        clearCategory: 'Vaciar la categoría IA',
        confirmClearCategory: '¿Eliminar todos los ejercicios que armó el asistente? Esto no se puede deshacer.',
        promptRename: 'Nombre para este ejercicio:',
        readout: 'Paso {n} — {label}.',
        readoutFrom: 'Paso {n} — {label}, del preset «{name}».',
        readoutTail: '{reps} repeticiones, {bpm} bpm.',
        role: {
            serve: 'saque',
            push: 'push',
            drive: 'drive',
            loop: 'loop',
            block: 'bloqueo'
        },
        rot: {
            top: 'top',
            back: 'cortado',
            side: 'lateral',
            flat: 'plano'
        },
        // El sidespin es un NOMBRE, no una máquina: el robot solo gira top o
        // back, y el sidespin sale girando la cabeza a mano.
        sideSpinManual: 'sidespin - girá la cabeza a mano',
        sideSpinManualTo: 'sidespin {where} - girá la cabeza a mano',
        sideSpinChip: 'cabeza a mano',
        sideSpinChipTo: 'cabeza a mano, {where}',
        sideSpinWhy: 'El robot no puede girar sideways solo. Girale la cabeza a mano antes de este paso.',
        side: {
            bh: 'al revés',
            center: 'al medio',
            fh: 'a la derecha'
        },
        strength: {
            low: 'suave',
            high: 'fuerte'
        }
    },

    // --- showToast() calls, everywhere ---
    toast: {
        default: 'Notificación',
        installing: 'Instalando Nova…',
        notConnected: 'Dispositivo no conectado',
        configSaved: 'Configuración guardada',
        openDrillFirst: 'Abre un ejercicio primero',
        presetNotFound: 'Preset no encontrado',
        drillFull: 'El ejercicio está lleno ({max} bolas)',
        onlyLeft: 'Solo quedan {n} en este ejercicio',
        ballsAdded: {
            one: '+{n} bola de «{name}»',
            other: '+{n} bolas de «{name}»'
        },
        scatterLimit: 'El límite es {n} para esta posición',
        cannotDeleteLastBall: 'No se puede eliminar la última bola',
        enterAName: 'Escribe un nombre',
        nameTooLong: 'Nombre demasiado largo',
        nameTooLong25: 'Nombre demasiado largo (máx. 25)',
        nameTooLong30: 'Nombre demasiado largo (máx. 30)',
        bankFull: '¡El banco {bank} está lleno!',
        bankFullMax100: '¡Ese banco está lleno (máx. 100)!',
        categoryFull: 'La categoría está llena (máx. 100)',
        savedTo: 'Guardado en {bank}',
        movedTo: 'Movido a {bank}',
        created: '{name} creado',
        drillDeleted: 'Ejercicio eliminado',
        renamed: 'Renombrado',
        testBallFired: 'Bola de prueba enviada',
        testFailed: 'La prueba falló',
        noActiveBalls: 'No hay bolas activas',
        noActiveBallsToPlay: 'no hay bolas activas para jugar',
        testingDrill: 'Probando el ejercicio...',
        shareFailed: 'No se pudo compartir. Revisa la conexión.',
        givePresetName: 'Ponle un nombre al preset',
        presetSaved: 'Preset «{name}» guardado',
        presetDeleted: '«{name}» eliminado',
        presetsExported: 'Presets exportados',
        presetsImported: '{added} nuevos importados, {updated} actualizados',
        nothingNewToImport: 'No hay nada nuevo que importar',
        noPresetsInFile: 'No se encontraron presets en el archivo',
        importFailed: 'La importación falló',
        aiSaved: 'Guardado en la pestaña IA',
        aiCleared: 'Ejercicios de IA eliminados',
        aiMoved: 'Movido a {bank}',
        presetsReset: 'Presets restablecidos a los originales',
        maxPerAxis: 'Máx. 6 por eje',
        sessionDeleted: 'Sesión eliminada',
        sessionNotFound: 'Sesión no encontrada',
        historyDeleted: 'Historial eliminado',
        savedAsDefault: 'Guardado como predeterminado',
        restored: 'Restaurado',
        statsReset: 'Estadísticas restablecidas',
        drillsImported: 'Importado correctamente',
        drillsImportFailed: 'La importación falló',
        invalidCode: 'Código no válido (debe tener 6 caracteres)',
        searching: 'Buscando...',
        codeNotFound: 'Código no encontrado',
        importedTo: 'Importado en {bank}',
        downloadError: 'Error de descarga'
    },

    // --- prompt() captions ---
    prompt: {
        newDrillName: 'Escribe el nombre del ejercicio nuevo:',
        renameDrill: 'Renombrar ejercicio:',
        shareCopy: '¡Ejercicio compartido! Copia este código:'
    },

    // --- confirm() messages ---
    confirm: {
        deleteDrill: '¿Eliminar este ejercicio?',
        deletePreset: '¿Eliminar el preset «{name}»?',
        resetPresets: '¿Sustituir la biblioteca de presets por los originales? Los presets ya usados en ejercicios no se ven afectados.',
        saveAsDefault: '¿Guardar los ajustes actuales como tu nuevo predeterminado?',
        restoreSaved: '¿Restaurar los predeterminados guardados?',
        restoreFactory: '¿Restaurar los ajustes de fábrica?',
        factoryReset: 'AVISO: ¿Eliminar TODOS los datos guardados y volver al estado original de fábrica?',
        resetStats: '¿Restablecer las estadísticas? Esto borra los contadores y todo el historial de entrenamiento.',
        deleteAllSessions: '¿Eliminar todo el historial de entrenamiento? Esto no se puede deshacer.'
    },

    // --- alert() after a successful share ---
    alert: {
        shareSuccess: '¡Ejercicio compartido!\n\nCódigo: {code}\n\n(Copiado al portapapeles)'
    },

    // --- index.html: aria-labels and tooltips that are not visible text ---
    a11y: {
        backToDrills: 'Volver a los ejercicios',
        backToSettings: 'Volver a los ajustes',
        deleteDrill: 'Eliminar',
        deletePreset: 'Eliminar preset',
        deleteSessionFrom: 'Eliminar la sesión del {when}',
        deleteSessionTitle: 'Eliminar esta sesión',
        createNewDrill: 'Crear un ejercicio nuevo',
        dragToReorder: 'Arrastra para reordenar',
        installApp: 'Instalar Nova',
        openAi: 'Abrir el asistente IA',
        talk: 'Hablarle al asistente',
        send: 'Enviar lo que escribiste',
        // El botón de parar cubre la respuesta hablada, el turno del modelo en
        // curso y una grabación abierta, así que dice las tres cosas.
        stop: 'Detener al asistente'
    },

    placeholder: {
        myNewDrill: 'Mi ejercicio nuevo',
        presetName: 'Nombre del preset',
        label: 'Etiqueta',
        shareCode: 'ABC123'
    }
};
