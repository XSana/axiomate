import React from 'react'
import { render, Box, Text } from './src/ink.js'

const App = () => (
  <Box flexDirection="column">
    <Text color="green">Axiomate ink test - if you see this, ink works!</Text>
    <Text>Press Ctrl+C to exit</Text>
  </Box>
)

const instance = await render(<App />)
await instance.waitUntilExit()
