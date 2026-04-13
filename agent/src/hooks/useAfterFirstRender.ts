import { useEffect } from 'react'
import { isEnvTruthy } from '../utils/envUtils.js'

export function useAfterFirstRender(): void {
  useEffect(() => {
    // Exit-after-first-render was ant-only, now a no-op
  }, [])
}
