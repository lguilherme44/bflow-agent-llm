export interface Data { id: number }
export class Service {
  async execute(data: Data): Promise<void> {
    console.log(data.id);
  }
}
const internal = () => { return 1; };
