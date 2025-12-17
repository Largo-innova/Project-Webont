import { ObjectId } from "mongodb";

export interface Character {
    _id?: ObjectId;
    id: string;
    name: string;
    age: number;
    description: string;
    isActive: boolean;
    rank: string;
    birthDate: string;
    imageUrl: string;
    weapons: string[];
    unit: {
        id: string;
        name: string;
        emblemUrl: string;
        motto: string;
        isElite: boolean;
        foundedYear: number;
    }
}

export interface User {
    _id?: ObjectId;
    username: string;
    password: string;
    role: 'ADMIN' | 'USER';
}