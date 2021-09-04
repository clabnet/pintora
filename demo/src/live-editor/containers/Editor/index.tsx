import React, { useCallback } from 'react'
import CodeMirrorEditor from 'src/live-editor/components/CodeMirrorEditor'
import { useDispatch, connect, ConnectedProps } from 'react-redux'
import { State, actions } from 'src/live-editor/redux/slice'
import './Editor.less'

const CODE_EDITOR_OPTIONS = {
  language: 'pintora',
}

function Editor(props: Props) {
  const { editorCode, show, errorInfo } = props
  const dispatch = useDispatch()

  const onCodeChange = useCallback(code => {
    dispatch(actions.updateEditorCode({ code }))
  }, [])

  const style = {
    display: show ? 'flex' : 'none',
  }
  return (
    <div className="Editor" style={style}>
      <CodeMirrorEditor
        code={editorCode}
        onCodeChange={onCodeChange}
        editorOptions={CODE_EDITOR_OPTIONS}
        errorInfo={errorInfo}
      ></CodeMirrorEditor>
    </div>
  )
}

const connector = connect((state: State) => {
  return {
    editorCode: state.editor.code,
    errorInfo: state.editor.error,
    show: state.currentEditor === 'code',
  }
})

type Props = ConnectedProps<typeof connector>

export default connector(Editor)