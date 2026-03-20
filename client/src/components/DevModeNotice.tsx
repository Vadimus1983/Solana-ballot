export function DevModeNotice() {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
      <span className="text-lg">⚠️</span>
      <span>
        <strong>ZK proof: development mode.</strong> The on-chain verifying key
        is not initialized — Groth16 proof verification is skipped. Any dummy
        proof is accepted. Real verification activates after{" "}
        <code className="font-mono bg-yellow-100 px-1 rounded">store_vk</code>{" "}
        is called with a valid trusted-setup key.
      </span>
    </div>
  );
}
