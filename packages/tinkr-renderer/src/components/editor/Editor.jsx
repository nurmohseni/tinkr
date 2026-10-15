import {useMemo, useEffect, useRef, useCallback} from 'react'
import * as monaco from 'monaco-editor'
// monaco resolves its worker url itself, and the module it asks for is not a url
// in the vite build: bundling the worker and handing it over through the
// environment monaco looks for first is what makes the worker load
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import debounce from 'lodash/debounce'

import {registerPHPSnippetLanguage} from '../../utils/registerPHPSnippetLanguage'
import {registerPHPCompletionProvider} from '../../utils/phpCompletion'
import {editorFont, watchEditorTheme} from '../../utils/monacoTheme'
import {documentAtomWithId, isSessionId, writeCodeAtom} from '../../stores/sessions'
import {applyCodeAtom, runAtom, sizesAtom} from '../../stores/editor'
import {loadedHistoryAtom} from '../../stores/history'
import {configAtom} from '../../stores/config'
import {isMatchShortcut} from '../../utils/isMatchShortcut'
import useDocumentId from '../../hooks/useDocumentId'
import {aiComplete, phpCompletions} from '../../utils/api'

// the wait before a suggestion is asked for, when the preference holds nothing
// the timer can take
const DEFAULT_AI_DELAY = 400

// the getWorker hook is what monaco's standalone worker service asks first, and
// it takes the worker itself rather than a url
self.MonacoEnvironment = {getWorker: () => new EditorWorker()}

const Editor = () => {
  const domRef = useRef()
  const editorRef = useRef()
  const editorEventsRef = useRef()
  const editorHandleDownEventRef = useRef()
  const intl = useIntl()

  // the route names the snippet the window is on; at the root route the well
  // shows the session the window is on, the way it always has
  const documentId = useDocumentId()
  const isSession = isSessionId(documentId)
  const document = useAtomValue(documentAtomWithId(documentId))
  const writeCode = useSetAtom(writeCodeAtom)
  const loadedHistory = useAtomValue(loadedHistoryAtom)
  const sizes = useAtomValue(sizesAtom)
  const run = useSetAtom(runAtom)
  const config = useAtomValue(configAtom)
  const applied = useAtomValue(applyCodeAtom)
  const aiRef = useRef(config)

  useEffect(() => {
    aiRef.current = config
  }, [config])

  // monaco paints its own chrome, so it takes the design's code tokens, and it
  // follows the theme attribute the rest of the chrome switches on
  useEffect(() => watchEditorTheme(monaco), [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const writeCodeDebounced = useCallback(debounce(value => writeCode(value), 200), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runDebounced = useCallback(debounce(code => run(code), 500), [])

  // 重置编辑器的事件和代码
  const resetEditor = editor => {
    if (!document) {
      return
    }

    const {id, code, position} = document
    // 设置代码
    editor.setValue(code)
    if (position) {
      // 设置光标位置
      editor.setPosition(position)
    }

    editor.focus()

    // 光标与代码修改的时候触发 handleChange
    const handleChange = () => {
      const value = {
        id,
        code: editor.getValue(),
        position: editor.getPosition(),
      }

      // a session is this window's own memory, so it is written on every
      // keystroke; a snippet lands in the connection's file, so it waits for a
      // pause in the typing
      if (isSession) {
        writeCode(value)
        return
      }

      writeCodeDebounced(value)
    }

    const onPositionChange = editor.onDidChangeCursorPosition(handleChange)
    const onCodeChange = editor.onDidChangeModelContent(handleChange)

    return [
      onPositionChange,
      onCodeChange,
    ]
  }

  const handleEditorKeyDown = editor => {
    return editor.onKeyDown(async e => {
      if (isMatchShortcut(e.browserEvent, config.shortcut_run)) {
        e.preventDefault()
        e.stopPropagation()
        await editor.getAction('run-php-snippet').run()
        return false
      }

      return true
    })
  }

  // 当 resize 事件触发的时候，编辑器触发 layout
  useEffect(() => {
    const layout = () => editorRef.current.layout()
    window.addEventListener('resize', layout)
    return () => window.removeEventListener('resize', layout)
  }, [])

  // 编辑器和命令行的高度发生改变触发 layout
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout()
    }
  }, [sizes])

  // 更新代码
  useEffect(() => {
    const editor = editorRef.current
    let events = null

    // 解绑初始化的事件
    if (editorEventsRef.current) {
      for (const event of editorEventsRef.current) {
        event.dispose()
      }
    }

    if (editor) {
      events = resetEditor(editor)
    }

    return () => {
      if (events) {
        for (const event of events) {
          event.dispose()
        }
      }
    }
  }, [documentId])

  // the ai panel asks the editor to take code, and the editor is what holds the
  // model: what it takes is written on by the same listener typing goes through
  useEffect(() => {
    const editor = editorRef.current

    if (!editor || !applied || applied.id !== documentId) {
      return
    }

    editor.setValue(applied.code)
    // the end of what was just taken is where writing goes on from
    editor.setPosition(editor.getModel().getPositionAt(applied.code.length))
    editor.focus()
  }, [applied])

  useEffect(() => {
    const editor = editorRef.current

    if (editor) {
      if (editorHandleDownEventRef.current) {
        editorHandleDownEventRef.current.dispose()
      }

      const event = handleEditorKeyDown(editor)

      return () => {
        event.dispose()
      }
    }
  }, [config.shortcut_run])

  useEffect(() => {
    // 注册 php-snippet
    registerPHPSnippetLanguage(monaco.languages)

    const editor = monaco.editor.create(domRef.current, {
      language: 'php-snippet',
      lineNumbers: 'on',
      // the snippet's own words are not the project's classes, and the suggestion
      // popup is what the class index answers, so monaco's two other sources of
      // completion are off: words from the document, and quick suggestions held
      // back while the AI ghost text is showing
      wordBasedSuggestions: 'off',
      quickSuggestions: {other: 'on', comments: 'off', strings: 'off'},
      ...editorFont(),
    })

    editor.addAction({
      id: 'run-php-snippet',
      label: intl.formatMessage({id: 'editor.run'}),
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: ed => {
        runDebounced(ed.getValue())
        return null
      },
    })

    // 初始化 editor 代码、光标、事件
    editorEventsRef.current = resetEditor(editor)
    editorHandleDownEventRef.current = handleEditorKeyDown(editor)

    // 第一次编辑器加载完成触发 layout
    const layoutTimer = setTimeout(() => {
      // 加上 timeout 修复当从 form mode 切换回来之后，form 还没有完全 unmounted
      editor.layout()
    }, 50)

    const inlineProvider = monaco.languages.registerInlineCompletionsProvider('php-snippet', {
      provideInlineCompletions: async (model, position, context, token) => {
        const settings = aiRef.current

        // the model has to be there for a suggestion to be asked of, and the
        // setting has to be on for it to be wanted
        if (!settings.ai_model || !settings.ai_autocomplete) {
          return {items: []}
        }

        const code = model.getValue()
        const offset = model.getOffsetAt(position)

        // monaco cancels this call as soon as the text changes again, so the
        // wait is what keeps a request from going out on every keystroke, and
        // how long it is is the user's to set (preference.ai_delay)
        const delay = Number(settings.ai_delay)

        await new Promise(resolve => setTimeout(
          resolve,
          Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_AI_DELAY,
        ))

        if (token.isCancellationRequested) {
          return {items: []}
        }

        try {
          const {completion} = await aiComplete({
            prefix: code.slice(Math.max(0, offset - 2000), offset),
            suffix: code.slice(offset, offset + 1000),
          })

          if (token.isCancellationRequested || !completion) {
            return {items: []}
          }

          return {items: [{insertText: completion}]}
        } catch (e) {
          return {items: []}
        }
      },
      freeInlineCompletions: () => {},
      // monaco disposes through this name, and throws without it, which aborts
      // the suggestion cycle before anything is shown
      disposeInlineCompletions: () => {},
    })

    // the classes of the connection's project, and the methods of the class a
    // `::` was written after: the same popup, two answers
    const completionProvider = registerPHPCompletionProvider(monaco, phpCompletions)

    editorRef.current = editor

    return () => {
      completionProvider.dispose()
      inlineProvider.dispose()
      editor.dispose()

      const model = editor.getModel()
      if (model) {
        model.dispose()
      }

      clearTimeout(layoutTimer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a history row hands its code to the snippet the window is on, and the
  // editor shows it: writing the model is the write the typing makes, so the
  // store, the file, and the pane end up with the code that ran
  useEffect(() => {
    const editor = editorRef.current

    if (!editor || !loadedHistory || loadedHistory.snippetId !== documentId) {
      return
    }

    if (editor.getValue() !== loadedHistory.code) {
      editor.setValue(loadedHistory.code)
      editor.focus()
    }
  }, [loadedHistory, documentId])

  return useMemo(() => (
    // the well around it is the design's .editor, so monaco fills it
    <div className='grow' ref={domRef}/>
  ), [])
}

export default Editor
