import type { Address } from "viem";

type AddressRowProps = {
  name: string;
  address: Address | null;
};

/** One contract address, labelled, in the mono face. */
export default function AddressRow({ name, address }: AddressRowProps) {
  return (
    <div className="address-row">
      <span>{name}</span>
      <code className="mono">{address ?? "Loading..."}</code>
    </div>
  );
}
